import Anthropic from "@anthropic-ai/sdk";
import WebSocket from "ws";
import { SpeechToText } from "./stt.js";
import { callManager } from "../lib/call-manager.js";
import { db } from "../db/index.js";
import { menuItems, orders, orderItems, reservations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { config } from "../config.js";

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  return anthropic;
}

const activeAgents = new Set<string>();

// ---------------------------------------------------------------------------
// Safety limits (Phase 2 — configurable per merchant, hardcoded defaults)
// ---------------------------------------------------------------------------
const SAFETY = {
  maxQtyPerLine: 10,
  confirmQtyThreshold: 5,
  confirmTotalThreshold: 150,
  transferTotalThreshold: 400,
  maxTotalItems: 30,
};

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface OrderState {
  items: OrderItem[];
  customerName: string;
  notes: string;
  orderId: string | null;
  confirmed: boolean;
  largeTotalConfirmed: boolean; // fired once per call
}

interface ReservationState {
  guestName: string;
  partySize: number | null;
  date: string;     // YYYY-MM-DD
  timeSlot: string; // HH:MM
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Deepgram TTS — male voice (aura-arcas-en)
// ---------------------------------------------------------------------------
async function textToSpeech(text: string, retries = 2): Promise<Buffer> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
      const response = await fetch(
        "https://api.deepgram.com/v1/speak?model=aura-arcas-en&encoding=mulaw&sample_rate=8000&container=none",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${config.deepgramApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`Deepgram TTS ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      console.error(`[TTS] Attempt ${attempt + 1} failed: ${err}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 200)); // brief pause before retry
        continue;
      }
      // All retries exhausted — return silence (160 bytes = 20ms of mulaw silence)
      console.error(`[TTS] All retries failed for: "${text.slice(0, 50)}..." — returning silence`);
      return Buffer.alloc(160, 0x7f); // mulaw silence byte
    }
  }
  return Buffer.alloc(160, 0x7f); // fallback
}

function sendAudioToTwilio(socket: WebSocket, streamSid: string, audioBuffer: Buffer): void {
  const CHUNK_SIZE = 8000;
  for (let offset = 0; offset < audioBuffer.length; offset += CHUNK_SIZE) {
    const chunk = audioBuffer.subarray(offset, offset + CHUNK_SIZE);
    socket.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload: chunk.toString("base64") },
    }));
  }
}

function clearTwilioAudio(socket: WebSocket, streamSid: string): void {
  socket.send(JSON.stringify({ event: "clear", streamSid }));
}

// ---------------------------------------------------------------------------
// Menu helpers + pre-warmed greeting audio
// ---------------------------------------------------------------------------
let cachedMenuContext: string | null = null;
let cachedGreetingAudio: Buffer | null = null;
let cachedFillerAudios: Buffer[] = [];
const GREETING_TEXT = "Thanks for reaching out to A2B Indian Veg Restaurant. I can help with menu questions, takeaway orders, or table reservations. How can I help you today?";
const FILLER_PHRASES = [
  "One moment.",
  "Just a sec.",
  "Let me check.",
  "Bear with me.",
  "Hold on.",
  "Give me a moment.",
];

export async function warmMenuCache(): Promise<void> {
  cachedMenuContext = null;
  await getMenuContext();
  // Pre-warm greeting + all filler phrases so they play instantly
  const [greeting, ...fillers] = await Promise.all([
    textToSpeech(GREETING_TEXT),
    ...FILLER_PHRASES.map(p => textToSpeech(p)),
  ]);
  cachedGreetingAudio = greeting;
  cachedFillerAudios = fillers;
  console.log(`Menu cache warmed, greeting + ${fillers.length} fillers pre-loaded`);
}

async function getMenuContext(): Promise<string> {
  if (cachedMenuContext) return cachedMenuContext;
  const items = await db.select({
    name: menuItems.name,
    price: menuItems.price,
    category: menuItems.category,
  }).from(menuItems).where(eq(menuItems.available, true));

  const grouped: Record<string, string[]> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(`${item.name}($${parseFloat(item.price).toFixed(2)})`);
  }
  cachedMenuContext = Object.entries(grouped)
    .map(([cat, list]) => `${cat}: ${list.join(", ")}`)
    .join("\n");
  return cachedMenuContext;
}

function orderTotal(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}

// ---------------------------------------------------------------------------
// Build system prompt covering all phases
// ---------------------------------------------------------------------------
function buildSystemPrompt(menuContext: string, orderState: OrderState, reservationState: ReservationState): string {
  const currentOrder = orderState.items.length > 0
    ? orderState.items.map(i => `${i.quantity}x ${i.name} @ $${i.unitPrice.toFixed(2)}`).join(", ")
    : "nothing yet";
  const runningTotal = orderTotal(orderState.items).toFixed(2);

  const now = new Date();
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const todayName = dayNames[now.getDay()];
  const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

  // Pre-compute upcoming dates so Claude never needs to calculate
  function addDays(d: Date, n: number): string {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r.toISOString().split("T")[0];
  }
  const todayDay = now.getDay(); // 0=Sun..6=Sat
  const daysToTomorrow = 1;
  const daysToSaturday = (6 - todayDay + 7) % 7 || 7;
  const daysToCurFriday = (5 - todayDay + 7) % 7 || 7;
  const daysToSunday = (7 - todayDay) % 7 || 7;
  const daysToNextMonday = (1 - todayDay + 7) % 7 || 7;

  const upcomingDates = [
    `- Tomorrow (${dayNames[(todayDay + 1) % 7]}): ${addDays(now, 1)}`,
    daysToCurFriday <= 7 ? `- This Friday: ${addDays(now, daysToCurFriday)}` : "",
    `- This Saturday: ${addDays(now, daysToSaturday)}`,
    `- This Sunday: ${addDays(now, daysToSunday)}`,
    `- Next Monday: ${addDays(now, daysToNextMonday)}`,
    `- Next Saturday: ${addDays(now, daysToSaturday + 7)}`,
  ].filter(Boolean).join("\n");

  return `You are Alex, a friendly voice assistant at A2B Indian Veg Restaurant. You help with menu questions, takeaway orders (pay at store), and table reservations.

TODAY IS: ${todayName}, ${todayStr}

PRE-CALCULATED UPCOMING DATES (use these directly — do NOT ask the customer to clarify):
${upcomingDates}
Current month: ${monthNames[now.getMonth()]} ${now.getFullYear()}

MENU (all items available):
${menuContext}

CURRENT ORDER: ${currentOrder} | Running total: $${runningTotal}
CUSTOMER NAME: ${orderState.customerName || "not captured yet"}

RESERVATION IN PROGRESS: ${reservationState.guestName ? `Name: ${reservationState.guestName}, Party: ${reservationState.partySize ?? "?"}, Date: ${reservationState.date || "?"}, Time: ${reservationState.timeSlot || "?"}` : "none"}

RULES:
- Plain text only. No asterisks, dashes, bullet points, or markdown.
- MAXIMUM ONE SENTENCE per response. This is a phone call — be quick and direct.
- EXCEPTION: order readback before confirmation may have multiple sentences (one per item + total).
- Never say "Great!" or "Perfect!" or "Got it!" as a separate sentence. Combine it into the question: "Got it, what time?" not "Got it! What time would you like?"
- NEVER repeat information the customer already gave you. If you know the date, do NOT say it again when asking for time. If you know the name, do NOT say it again when asking for party size.
- Never mention prices while ordering. Only in the final order summary.
- NEVER transfer unless customer explicitly asks or total exceeds $400.
- NEVER read out the full menu. Say category names only: "We have dosas, curries, appetizers, desserts and more — which category interests you?"

HANDLING UNCLEAR SPEECH:
- Phone lines distort words. Always guess from context rather than asking to repeat.
- If you just listed items and the customer says something unclear, assume they are picking one — say "Got it, shall I add [first item you listed] to your order?"
- For numbers/dates: "For" = four, "Tree" = three, "Lavanta/Elevanta" = eleven. Confirm your guess: "I think you said four — is that right?"
- Only ask to repeat if the response is completely off-topic (e.g. the customer is talking to someone else).
- If you already answered a question and the customer seems to ask the same thing again, do NOT repeat the same answer. Instead acknowledge and move forward: "I mentioned those — would you like to order one?" or "Shall I add that to your order?"

WHAT YOU CAN DO:
1. Answer menu questions — tell customers our categories, describe dishes in a category, share ingredients. Say prices only if directly asked.
2. Take takeaway orders — add items, confirm additions, modify if asked. All orders are pay at the store.
3. Take table reservations — get name, party size, date, time.

ORDER FLOW:
- When customer wants to order, add items as they name them. After each item say e.g. "Got it, one masala dosa. Anything else?"
- When customer says they are done, ask "Can I get a name for this order?"
- When customer gives their name, always echo it back clearly: "Thank you [Name], let me read back your order." Use whatever name the customer said, even if it sounds unusual — it may be an Indian name.
- Then read back the full order with each item, quantity, price, and total. End with "You can pay when you arrive. Shall I confirm this order?"
- When customer says yes to confirm: write ORDER_CONFIRMED first, then a brief thank-you. Example: "ORDER_CONFIRMED Thank you, your order is placed!"
- When customer cancels: write ORDER_CANCELLED first. Example: "ORDER_CANCELLED No problem, call us back anytime."

SAFETY LIMITS:
- Quantity 5 or more for one item: confirm "Just to make sure, that is [qty] [item]?"
- Quantity over 10: say max is 10 per item and ask what they prefer.
- Total over $150: say "Your total is $[amount], just want to make sure that looks right. Ready to continue?"
- Total over $400: say "This is a large order, let me connect you with the restaurant." then write TRANSFER_TO_HUMAN.

RESERVATION FLOW:
- You need four pieces: name, party size, date, time. Customer may give some upfront — accept whatever they provide and ask for the NEXT missing piece.
- If customer says "book for Saturday" — date is done. Next ask: "What's your name?"
- If someone says a word that isn't a number when you asked a question, it's probably their NAME. Accept it.
- Response format — combine acknowledgment and next question in ONE sentence:
  "What's your name?" / "Got it Selvan, how many people?" / "Party of four, what time?" / "Selvan, four people, Saturday at 7:30 — shall I confirm?"
- For dates: use pre-calculated dates. "This Saturday" = look it up directly.
- For time: convert to HH:MM 24-hour zero-padded (e.g. 19:30).
- Only the FINAL confirmation sentence should repeat all details.
- On yes: RESERVATION_CONFIRMED:[name]:[partySize]:[YYYY-MM-DD]:[HH:MM] first, then short message.

TRANSFER:
- Only if customer explicitly says "speak to a person", "talk to someone", or "human": write TRANSFER_TO_HUMAN first. Example: "TRANSFER_TO_HUMAN Of course, one moment."
- Total over $400: write TRANSFER_TO_HUMAN.

CRITICAL TOKEN RULE: Always write ORDER_CONFIRMED, ORDER_CANCELLED, RESERVATION_CONFIRMED, or TRANSFER_TO_HUMAN at the VERY START of your response when that action applies — never at the end. This ensures the action is captured even if the message is cut short.`;
}

// ---------------------------------------------------------------------------
// Streaming Claude response → sentence-by-sentence TTS
// ---------------------------------------------------------------------------
async function handleTranscript(
  callSid: string,
  transcript: string,
  conversation: ConversationMessage[],
  orderState: OrderState,
  reservationState: ReservationState,
  menuContext: string,
  socket: WebSocket,
  streamSid: string,
  signal?: AbortSignal,
  onFirstAudio?: () => void
): Promise<void> {
  conversation.push({ role: "user", content: transcript });

  const systemPrompt = buildSystemPrompt(menuContext, orderState, reservationState);
  clearTwilioAudio(socket, streamSid);

  let fullReply = "";
  let buffer = "";
  let totalAudioBytes = 0;
  let pendingTts: Promise<Buffer> | null = null;
  let firstAudioSentAt: number | null = null;
  let lastAudioSentAt: number | null = null;
  let lastChunkBytes = 0;

  const TOKENS = ["ORDER_CONFIRMED", "ORDER_CANCELLED", "TRANSFER_TO_HUMAN"];
  function stripTokens(text: string): string {
    let out = text;
    for (const t of TOKENS) out = out.replace(t, "");
    // Match full RESERVATION_CONFIRMED token including names with spaces
    out = out.replace(/RESERVATION_CONFIRMED:[^:]+:\d+:\d{4}-\d{2}-\d{2}:\d{1,2}:\d{2}/g, "");
    return out.trim();
  }

  async function flushSentence(sentence: string) {
    const clean = stripTokens(sentence).trim();
    if (!clean || socket.readyState !== WebSocket.OPEN) return;
    console.log(`[${callSid}] TTS: "${clean}"`);
    const audio = pendingTts ? await pendingTts : await textToSpeech(clean);
    pendingTts = null;
    totalAudioBytes += audio.length;
    lastChunkBytes = audio.length;
    const now = Date.now();
    if (!firstAudioSentAt) {
      firstAudioSentAt = now;
      onFirstAudio?.();
    }
    lastAudioSentAt = now;
    sendAudioToTwilio(socket, streamSid, audio);
  }

  let llmFailed = false;
  try {
    const stream = getAnthropic().messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system: systemPrompt,
      messages: conversation,
    });

    for await (const chunk of stream) {
      if (signal?.aborted) {
        console.log(`[${callSid}] Barge-in: aborting response`);
        clearTwilioAudio(socket, streamSid);
        break;
      }
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        buffer += chunk.delta.text;
        fullReply += chunk.delta.text;

        const match = buffer.match(/^(.*?[.!?])\s+/s) || buffer.match(/^(.+)\n\n/s);
        if (match) {
          const sentence = match[1];
          buffer = buffer.slice(match[0].length);
          const nextSnippet = stripTokens(buffer).trim();
          if (nextSnippet && !pendingTts) pendingTts = textToSpeech(nextSnippet);
          await flushSentence(sentence);
        }
      }
    }
  } catch (err) {
    console.error(`[${callSid}] LLM error:`, err);
    llmFailed = true;
    fullReply = "Sorry, I'm having a little trouble right now. Could you say that again?";
    await flushSentence(fullReply);
  }

  if (!signal?.aborted && !llmFailed) {
    // Flush any remaining buffer
    const remaining = buffer.trim();
    if (remaining) {
      const lines = remaining.split(/\n+/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (signal?.aborted) break;
        await flushSentence(line);
      }
    }
  }

  // Don't push broken replies to conversation history
  if (llmFailed) {
    conversation.pop(); // remove the user message we added at the top
    return;
  }

  conversation.push({ role: "assistant", content: fullReply });

  // --- Handle special tokens ---
  if (fullReply.includes("ORDER_CONFIRMED")) {
    await saveOrder(callSid, orderState);
    const msg = "Thank you! Your order has been placed and will be ready in about 30 minutes. You can pay at the store when you arrive. Thanks for choosing A2B Indian Veg Restaurant, have a great rest of your day!";
    if (socket.readyState === WebSocket.OPEN) {
      const audio = await textToSpeech(msg);
      sendAudioToTwilio(socket, streamSid, audio);
      const waitMs = Math.ceil((audio.length / 8000) * 1000) + 800;
      setTimeout(() => endCall(callSid), waitMs);
    } else {
      setTimeout(() => endCall(callSid), 500);
    }
  }

  if (fullReply.includes("ORDER_CANCELLED")) {
    const msg = "No problem, your order has been cancelled. Feel free to call back anytime. Goodbye!";
    if (socket.readyState === WebSocket.OPEN) {
      const audio = await textToSpeech(msg);
      sendAudioToTwilio(socket, streamSid, audio);
      const waitMs = Math.ceil((audio.length / 8000) * 1000) + 800;
      setTimeout(() => endCall(callSid), waitMs);
    } else {
      setTimeout(() => endCall(callSid), 500);
    }
  }

  if (fullReply.includes("TRANSFER_TO_HUMAN")) {
    // "Of course, one moment." was already streamed above
    const waitMs = Math.ceil((lastChunkBytes / 8000) * 1000) + 800;
    setTimeout(() => endCall(callSid), waitMs);
  }

  const reservationMatch = fullReply.match(/RESERVATION_CONFIRMED:([^:]+):(\d+):(\d{4}-\d{2}-\d{2}):(\d{1,2}:\d{2})/);
  if (reservationMatch) {
    const [, name, partyStr, date, time] = reservationMatch;
    reservationState.guestName = name.trim();
    reservationState.partySize = parseInt(partyStr);
    reservationState.date = date;
    reservationState.timeSlot = time;
    reservationState.confirmed = true;
    await saveReservation(callSid, reservationState, callManager.getSession(callSid)?.callerPhone || "unknown");
    const dateObj = new Date(date + "T00:00:00");
    const readableDate = dateObj.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" });
    const msg = `Your table has been reserved for ${name}, party of ${partyStr}, on ${readableDate} at ${time}. We look forward to seeing you at A2B Indian Veg Restaurant. Thanks and have a great rest of your day!`;
    if (socket.readyState === WebSocket.OPEN) {
      const audio = await textToSpeech(msg);
      sendAudioToTwilio(socket, streamSid, audio);
      const waitMs = Math.ceil((audio.length / 8000) * 1000) + 800;
      setTimeout(() => endCall(callSid), waitMs);
    } else {
      setTimeout(() => endCall(callSid), 500);
    }
  }

  // Only run order extraction when we're actually in an ordering context (not reservations/menu Q&A)
  const isOrderContext = orderState.items.length > 0 ||
    /order|add|want|get me|i('|')ll have/i.test(transcript) ||
    /got it|added|anything else/i.test(fullReply);
  if (isOrderContext && !fullReply.includes("RESERVATION_CONFIRMED")) {
    updateOrderState(callSid, transcript, fullReply, orderState, menuContext).catch(
      (err) => {
        if (String(err).includes("rate_limit")) {
          console.log(`[${callSid}] Order extraction skipped (rate limit)`);
        } else {
          console.error(`[${callSid}] Order state update error:`, err);
        }
      }
    );
  }

}

async function endCall(callSid: string): Promise<void> {
  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    await client.calls(callSid).update({ status: "completed" });
    console.log(`[${callSid}] Call ended`);
  } catch (err) {
    console.error(`[${callSid}] Failed to end call:`, err);
  }
}

// ---------------------------------------------------------------------------
// Extract order updates from Claude's reply
// ---------------------------------------------------------------------------
async function updateOrderState(
  callSid: string,
  userMessage: string,
  assistantReply: string,
  orderState: OrderState,
  menuContext: string
): Promise<void> {
  // Direct name extraction from assistant echo-back (most reliable approach)
  // Patterns: "Thank you [Name], let me read" / "order under [Name]" / "I'll put this under [Name]" / "Great, [Name]!"
  if (!orderState.customerName) {
    const nameEchoPatterns = [
      /thank you ([A-Za-z][A-Za-z\s]{1,30}?)[,!.]/i,
      /order under ([A-Za-z][A-Za-z\s]{1,30}?)[,!.]/i,
      /put this under ([A-Za-z][A-Za-z\s]{1,30}?)[,!.]/i,
      /under the name ([A-Za-z][A-Za-z\s]{1,30}?)[,!.]/i,
      /great[,!]?\s+([A-Za-z][A-Za-z\s]{1,20}?)[,!]/i,
    ];
    for (const pattern of nameEchoPatterns) {
      const m = assistantReply.match(pattern);
      if (m && m[1] && m[1].trim().length > 1) {
        orderState.customerName = m[1].trim();
        console.log(`[${callSid}] Name captured from assistant echo: ${orderState.customerName}`);
        break;
      }
    }
  }

  const extraction = await getAnthropic().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: `Extract order details from the conversation. Return JSON only.
Menu: ${menuContext}
Format: {"items":[{"name":"exact menu name","quantity":1}],"customerName":"name if mentioned","notes":"special requests","done":false}
Set done=true only if assistant said ORDER_CONFIRMED.
Extract customerName ONLY if the assistant explicitly confirmed/echoed back the customer's name (e.g., "Thank you Ravi", "order under Priya", "Great, Suresh").`,
    messages: [{
      role: "user",
      content: `Customer: "${userMessage}"\nAssistant: "${assistantReply}"\nExisting items: ${JSON.stringify(orderState.items.map(i => ({ name: i.name, qty: i.quantity })))}`,
    }],
  });

  try {
    const raw = extraction.content[0].type === "text" ? extraction.content[0].text : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.customerName && !orderState.customerName) {
      orderState.customerName = parsed.customerName;
      console.log(`[${callSid}] Customer name: ${orderState.customerName}`);
    }
    if (parsed.notes) orderState.notes = parsed.notes;

    if (parsed.items?.length) {
      const allItems = await db.select().from(menuItems).where(eq(menuItems.available, true));
      for (const ordered of parsed.items) {
        const match = allItems.find(
          (m) =>
            m.name.toLowerCase().includes(ordered.name.toLowerCase()) ||
            ordered.name.toLowerCase().includes(m.name.toLowerCase())
        );
        if (!match) continue;

        const qty = ordered.quantity || 1;

        // Safety: enforce per-line max
        if (qty > SAFETY.maxQtyPerLine) {
          console.log(`[${callSid}] Safety: qty ${qty} exceeds max ${SAFETY.maxQtyPerLine} for ${match.name}`);
          continue;
        }

        const existing = orderState.items.find((i) => i.menuItemId === match.id);
        if (existing) {
          existing.quantity = qty;
        } else {
          // Safety: check total items
          const totalItems = orderState.items.reduce((s, i) => s + i.quantity, 0) + qty;
          if (totalItems > SAFETY.maxTotalItems) {
            console.log(`[${callSid}] Safety: total items ${totalItems} exceeds max ${SAFETY.maxTotalItems}`);
            continue;
          }
          orderState.items.push({
            menuItemId: match.id,
            name: match.name,
            quantity: qty,
            unitPrice: parseFloat(match.price),
          });
        }
      }
    }

    if (parsed.done && !orderState.confirmed && orderState.items.length > 0) {
      orderState.confirmed = true;
      await saveOrder(callSid, orderState);
    }
  } catch {
    // ignore parse errors
  }
}

async function saveOrder(callSid: string, orderState: OrderState): Promise<void> {
  if (orderState.orderId) return; // already saved
  const session = callManager.getSession(callSid);
  const total = orderTotal(orderState.items);

  const [order] = await db.insert(orders).values({
    status: "confirmed",
    total: total.toFixed(2),
    notes: orderState.notes || null,
    customerName: orderState.customerName || null,
    callerPhone: session?.callerPhone || null,
    callSid,
  }).returning();

  orderState.orderId = order.id;

  if (orderState.items.length > 0) {
    await db.insert(orderItems).values(
      orderState.items.map((item) => ({
        orderId: order.id,
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
      }))
    );
  }
  console.log(`[${callSid}] Order saved: ${order.id} | Customer: ${orderState.customerName} | Total: $${total.toFixed(2)}`);
}

async function saveReservation(
  callSid: string,
  state: ReservationState,
  callerPhone: string
): Promise<void> {
  try {
    await db.insert(reservations).values({
      guestName: state.guestName,
      guestPhone: callerPhone,
      partySize: state.partySize || 2,
      date: state.date,
      timeSlot: state.timeSlot,
      status: "confirmed",
      callSid,
    });
    console.log(`[${callSid}] Reservation saved: ${state.guestName} party of ${state.partySize} on ${state.date} at ${state.timeSlot}`);
  } catch (err) {
    console.error(`[${callSid}] Failed to save reservation:`, err);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function startVoiceAgent(callSid: string, socket: WebSocket): void {
  if (activeAgents.has(callSid)) {
    console.log(`[${callSid}] Agent already running, skipping`);
    return;
  }
  activeAgents.add(callSid);
  console.log(`[${callSid}] Voice agent starting`);

  const stt = new SpeechToText(config.deepgramApiKey);
  const conversation: ConversationMessage[] = [];
  const orderState: OrderState = {
    items: [], customerName: "", notes: "", orderId: null, confirmed: false, largeTotalConfirmed: false
  };
  const reservationState: ReservationState = {
    guestName: "", partySize: null, date: "", timeSlot: "", confirmed: false
  };

  let menuContext = "";
  let streamSid: string | null = null;
  const transcriptQueue: string[] = [];
  let processingQueue = false;
  let botSpeaking = false;
  let lastTranscriptTime = Date.now();
  let greetingDone = false;
  let currentAbort: AbortController | null = null;

  const updateStreamSid = () => {
    const session = callManager.getSession(callSid);
    if (session?.streamSid) streamSid = session.streamSid;
  };

  // Silence detection — prompt "Are you still there?" after 20s of no activity
  // lastTranscriptTime is reset both when a transcript arrives AND when bot finishes speaking
  const silenceTimer = setInterval(async () => {
    if (botSpeaking || !streamSid) return;
    const silent = Date.now() - lastTranscriptTime;
    if (silent > 20000 && silent < 35000) {
      if (socket.readyState === WebSocket.OPEN) {
        botSpeaking = true;
        try {
          const audio = await textToSpeech("Are you still there?");
          sendAudioToTwilio(socket, streamSid!, audio);
          await new Promise(r => setTimeout(r, Math.ceil((audio.length / 8000) * 1000) + 300));
          lastTranscriptTime = Date.now(); // reset so we get another 20s window
        } catch { /* ignore */ }
        finally { botSpeaking = false; }
      }
    } else if (silent >= 35000) {
      clearInterval(silenceTimer);
      botSpeaking = true;
      try {
        const audio = await textToSpeech("I did not hear anything. Please call us back if you need help. Goodbye!");
        if (socket.readyState === WebSocket.OPEN) sendAudioToTwilio(socket, streamSid!, audio);
        await new Promise(r => setTimeout(r, Math.ceil((audio.length / 8000) * 1000) + 500));
      } catch { /* ignore */ }
      endCall(callSid);
    }
  }, 5000);

  async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;

    while (transcriptQueue.length > 0) {
      const transcript = transcriptQueue.shift()!;
      lastTranscriptTime = Date.now();
      console.log(`[${callSid}] Transcript: "${transcript}"`);

      try {
        botSpeaking = true;
        updateStreamSid();
        if (!streamSid) { botSpeaking = false; continue; }

        // Filler: if first audio isn't sent within 1.5s, play "One moment" so customer isn't waiting in silence
        let fillerPlayed = false;
        let firstAudioReceived = false;
        const fillerTimer = setTimeout(() => {
          if (!firstAudioReceived && cachedFillerAudios.length > 0 && streamSid && socket.readyState === WebSocket.OPEN) {
            const idx = Math.floor(Math.random() * cachedFillerAudios.length);
            sendAudioToTwilio(socket, streamSid, cachedFillerAudios[idx]);
            fillerPlayed = true;
            console.log(`[${callSid}] Filler: "${FILLER_PHRASES[idx]}" (response slow)`);
          }
        }, 1500);

        const onFirstAudio = () => {
          firstAudioReceived = true;
          clearTimeout(fillerTimer);
        };

        currentAbort = new AbortController();
        await handleTranscript(
          callSid, transcript, conversation, orderState, reservationState, menuContext, socket, streamSid, currentAbort.signal, onFirstAudio
        );
        clearTimeout(fillerTimer);
        currentAbort = null;
      } catch (err) {
        if (String(err).includes("aborted")) {
          console.log(`[${callSid}] Response aborted (barge-in)`);
        } else {
          console.error(`[${callSid}] Pipeline error:`, err);
        }
      } finally {
        currentAbort = null;
        botSpeaking = false;
        lastTranscriptTime = Date.now();
      }
    }

    processingQueue = false;
  }

  // Play greeting and connect Deepgram IN PARALLEL for minimum latency.
  // Customer can speak during greeting — transcripts queue and process when greeting ends.
  async function playGreetingAndConnect() {
    updateStreamSid();
    const greetingAudio = cachedGreetingAudio ?? await textToSpeech(GREETING_TEXT);

    // Connect Deepgram immediately (in parallel with greeting playback)
    getMenuContext().then(ctx => { menuContext = ctx; }).catch(() => {});
    stt.connect().catch((err) => console.error(`[${callSid}] STT connect error:`, err));

    if (streamSid && socket.readyState === WebSocket.OPEN) {
      botSpeaking = true;
      sendAudioToTwilio(socket, streamSid, greetingAudio);
      const graceMs = Math.ceil((greetingAudio.length / 8000) * 1000) + 300;
      await new Promise(r => setTimeout(r, graceMs));
    }

    botSpeaking = false;
    lastTranscriptTime = Date.now();
    greetingDone = true;

    // Process any transcripts that arrived during greeting
    if (transcriptQueue.length > 0) processQueue();
  }

  playGreetingAndConnect().catch((err) => {
    console.error(`[${callSid}] Startup error:`, err);
    greetingDone = true;
    stt.connect().catch(() => {});
  });

  stt.on("connected", () => console.log(`[${callSid}] Deepgram connected`));

  stt.on("transcript", ({ transcript, speechFinal }: { transcript: string; isFinal: boolean; speechFinal: boolean }) => {
    if (!speechFinal || !transcript.trim()) return;
    updateStreamSid();
    if (!streamSid) {
      console.warn(`[${callSid}] No streamSid yet, skipping`);
      return;
    }
    transcriptQueue.push(transcript);

    // Barge-in: if bot is currently responding, abort it so customer's new message is handled fast
    if (currentAbort && processingQueue) {
      currentAbort.abort();
    }

    if (greetingDone) processQueue();
  });

  stt.on("error", (err: unknown) => console.error(`[${callSid}] STT error:`, err));

  // ALWAYS forward customer audio to Deepgram — Twilio media streams are uni-directional
  // (inbound = customer mic only, no bot echo), so there's nothing to filter.
  const audioHandler = ({ callSid: sid, payload }: { callSid: string; payload: string }) => {
    if (sid !== callSid) return;
    stt.sendAudio(payload);
  };
  callManager.on("audio:data", audioHandler);

  const endHandler = (session: { callSid: string }) => {
    if (session.callSid !== callSid) return;
    console.log(`[${callSid}] Voice agent cleanup`);
    clearInterval(silenceTimer);
    stt.disconnect();
    callManager.off("audio:data", audioHandler);
    callManager.off("session:ended", endHandler);
    activeAgents.delete(callSid);
  };
  callManager.on("session:ended", endHandler);
}
