import Anthropic from "@anthropic-ai/sdk";
import WebSocket from "ws";
import { SpeechToText } from "./stt.js";
import { callManager } from "../lib/call-manager.js";
import { db } from "../db/index.js";
import { menuItems, orders, orderItems } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { config } from "../config.js";

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  return anthropic;
}

// Guard: one agent per call
const activeAgents = new Set<string>();

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface OrderState {
  items: Array<{ menuItemId: string; name: string; quantity: number; unitPrice: number }>;
  notes: string;
  orderId: string | null;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Deepgram TTS → raw mulaw audio bytes (matches Twilio media stream format)
// ---------------------------------------------------------------------------
async function textToSpeech(text: string): Promise<Buffer> {
  const response = await fetch(
    "https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000&container=none",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Deepgram TTS error ${response.status}: ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Send audio back to caller directly over the Twilio media stream WebSocket
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

// Clear Twilio audio queue (call once per user turn, before first sentence)
function clearTwilioAudio(socket: WebSocket, streamSid: string): void {
  socket.send(JSON.stringify({ event: "clear", streamSid }));
}

// ---------------------------------------------------------------------------
// Menu helpers
// ---------------------------------------------------------------------------
// Cache menu context at module level — loaded once on first call
let cachedMenuContext: string | null = null;

export async function warmMenuCache(): Promise<void> {
  cachedMenuContext = null; // reset so fresh data is loaded
  await getMenuContext();
  console.log("Menu cache warmed");
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
    // Compact: no description, just name + price
    grouped[item.category].push(`${item.name}($${parseFloat(item.price).toFixed(2)})`);
  }

  // One line per category: "Dosai Corner: Plain Dosai($7.99), Onion Dosai($8.99), ..."
  cachedMenuContext = Object.entries(grouped)
    .map(([cat, list]) => `${cat}: ${list.join(", ")}`)
    .join("\n");

  return cachedMenuContext;
}

const ORDER_CONFIRMED_MSG = "Thank you! Your order has been placed and will be ready in 30 minutes. Thank you for choosing A2B Indian Veg Restaurant. Have a wonderful day. Goodbye!";

// ---------------------------------------------------------------------------
// Claude conversation — streams response and pipes sentences to TTS immediately
// ---------------------------------------------------------------------------
async function handleTranscript(
  callSid: string,
  transcript: string,
  conversation: ConversationMessage[],
  orderState: OrderState,
  menuContext: string,
  socket: WebSocket,
  streamSid: string
): Promise<string> {
  conversation.push({ role: "user", content: transcript });

  const systemPrompt = `You are a friendly voice ordering assistant for a restaurant called A2B Indian Veg Restaurant.
You help customers place food orders over the phone.

MENU:
${menuContext}

CURRENT ORDER:
Items: ${orderState.items.length > 0 ? orderState.items.map(i => `${i.quantity}x ${i.name}`).join(", ") : "none yet"}
Notes: ${orderState.notes || "none"}

RULES:
- Be concise — 1-2 sentences max (this is spoken audio).
- Help the customer pick from the menu above only.
- When they confirm they're done, summarize the order with total and say ORDER_CONFIRMED at the very end.
- If they cancel, say ORDER_CANCELLED at the very end.
- Do not mention ORDER_CONFIRMED or ORDER_CANCELLED unless the order is finalized.`;

  // Clear any ongoing audio before starting new response
  clearTwilioAudio(socket, streamSid);

  let fullReply = "";
  let buffer = "";

  const stream = getAnthropic().messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: systemPrompt,
    messages: conversation,
  });

  // Stream sentences to TTS as they arrive
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      buffer += chunk.delta.text;
      fullReply += chunk.delta.text;

      // Flush on sentence boundaries
      const match = buffer.match(/^(.*?[.!?])\s+/s);
      if (match) {
        const sentence = match[1].replace(/ORDER_CONFIRMED|ORDER_CANCELLED/g, "").trim();
        buffer = buffer.slice(match[0].length);
        if (sentence && socket.readyState === WebSocket.OPEN) {
          console.log(`[${callSid}] TTS sentence: "${sentence}"`);
          const audio = await textToSpeech(sentence);
          sendAudioToTwilio(socket, streamSid, audio);
        }
      }
    }
  }

  // Flush remaining buffer
  const remaining = buffer.replace(/ORDER_CONFIRMED|ORDER_CANCELLED/g, "").trim();
  if (remaining && socket.readyState === WebSocket.OPEN) {
    console.log(`[${callSid}] TTS sentence: "${remaining}"`);
    const audio = await textToSpeech(remaining);
    sendAudioToTwilio(socket, streamSid, audio);
  }

  conversation.push({ role: "assistant", content: fullReply });

  updateOrderState(callSid, transcript, fullReply, orderState, menuContext).catch(
    (err) => console.error(`[${callSid}] Order state update error:`, err)
  );

  // If order confirmed, play thank you message then hang up
  if (fullReply.includes("ORDER_CONFIRMED")) {
    if (socket.readyState === WebSocket.OPEN) {
      console.log(`[${callSid}] Playing thank you message`);
      const audio = await textToSpeech(ORDER_CONFIRMED_MSG);
      sendAudioToTwilio(socket, streamSid, audio);
    }
    // Wait for full message to finish playing before ending call
    // ORDER_CONFIRMED_MSG is ~10s of speech, add 2s buffer
    setTimeout(async () => {
      try {
        const twilio = (await import("twilio")).default;
        const client = twilio(config.twilio.accountSid, config.twilio.authToken);
        await client.calls(callSid).update({ status: "completed" });
        console.log(`[${callSid}] Call ended after thank you`);
      } catch (err) {
        console.error(`[${callSid}] Failed to end call:`, err);
      }
    }, 12000);
  }

  return fullReply.replace(/ORDER_CONFIRMED|ORDER_CANCELLED/g, "").trim();
}

async function updateOrderState(
  callSid: string,
  userMessage: string,
  assistantReply: string,
  orderState: OrderState,
  menuContext: string
): Promise<void> {
  const extraction = await getAnthropic().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: `Extract order details. Return JSON only, no explanation.
Menu: ${menuContext}
Format: {"items":[{"name":"exact menu name","quantity":1}],"notes":"special requests","done":false}
Set done=true only if assistant said ORDER_CONFIRMED.`,
    messages: [{
      role: "user",
      content: `Customer: "${userMessage}"\nAssistant: "${assistantReply}"\nExisting items: ${JSON.stringify(orderState.items.map(i => i.name))}`,
    }],
  });

  try {
    const raw = extraction.content[0].type === "text" ? extraction.content[0].text : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.notes) orderState.notes = parsed.notes;

    if (parsed.items?.length) {
      const allItems = await db.select().from(menuItems).where(eq(menuItems.available, true));
      for (const ordered of parsed.items) {
        const match = allItems.find(
          (m) =>
            m.name.toLowerCase().includes(ordered.name.toLowerCase()) ||
            ordered.name.toLowerCase().includes(m.name.toLowerCase())
        );
        if (match) {
          const existing = orderState.items.find((i) => i.menuItemId === match.id);
          if (existing) {
            existing.quantity = ordered.quantity || existing.quantity;
          } else {
            orderState.items.push({
              menuItemId: match.id,
              name: match.name,
              quantity: ordered.quantity || 1,
              unitPrice: parseFloat(match.price),
            });
          }
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
  const session = callManager.getSession(callSid);
  if (!session) return;

  const total = orderState.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const [order] = await db
    .insert(orders)
    .values({
      status: "confirmed",
      total: total.toFixed(2),
      notes: orderState.notes || null,
      callerPhone: session.callerPhone,
      callSid,
    })
    .returning();

  orderState.orderId = order.id;

  await db.insert(orderItems).values(
    orderState.items.map((item) => ({
      orderId: order.id,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
    }))
  );

  console.log(`[${callSid}] Order saved: ${order.id}`);
}

// ---------------------------------------------------------------------------
// Main entry point — called when media stream starts
// ---------------------------------------------------------------------------
export function startVoiceAgent(callSid: string, socket: WebSocket): void {
  // Guard against duplicate agents for same call
  if (activeAgents.has(callSid)) {
    console.log(`[${callSid}] Agent already running, skipping`);
    return;
  }
  activeAgents.add(callSid);
  console.log(`[${callSid}] Voice agent starting`);

  const stt = new SpeechToText(config.deepgramApiKey);
  const conversation: ConversationMessage[] = [];
  const orderState: OrderState = { items: [], notes: "", orderId: null, confirmed: false };
  let menuContext = "";
  let streamSid: string | null = null;
  const transcriptQueue: string[] = [];
  let processingQueue = false;
  let botSpeaking = false;

  // Get streamSid once session is set
  const updateStreamSid = () => {
    const session = callManager.getSession(callSid);
    if (session?.streamSid) streamSid = session.streamSid;
  };

  // Process queued transcripts one at a time
  async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;

    while (transcriptQueue.length > 0) {
      const transcript = transcriptQueue.shift()!;
      console.log(`[${callSid}] Transcript: "${transcript}"`);
      try {
        botSpeaking = true;
        await handleTranscript(callSid, transcript, conversation, orderState, menuContext, socket, streamSid!);
        // Keep muted briefly so last TTS chunk finishes playing before we listen again
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`[${callSid}] Pipeline error:`, err);
      } finally {
        botSpeaking = false;
      }
    }

    processingQueue = false;
  }

  // Load menu context
  getMenuContext()
    .then((ctx) => { menuContext = ctx; })
    .catch((err) => console.error(`[${callSid}] Menu load error:`, err));

  // Connect Deepgram STT
  stt.connect().catch((err) => console.error(`[${callSid}] STT connect error:`, err));

  stt.on("connected", () => console.log(`[${callSid}] Deepgram connected`));

  stt.on("transcript", ({ transcript, speechFinal }: { transcript: string; isFinal: boolean; speechFinal: boolean }) => {
    if (!speechFinal || !transcript.trim()) return;

    updateStreamSid();
    if (!streamSid) {
      console.warn(`[${callSid}] No streamSid yet, skipping transcript`);
      return;
    }

    transcriptQueue.push(transcript);
    processQueue();
  });

  stt.on("error", (err: unknown) => console.error(`[${callSid}] STT error:`, err));

  // Forward audio from Twilio → Deepgram (muted while bot is speaking)
  const audioHandler = ({ callSid: sid, payload }: { callSid: string; payload: string }) => {
    if (sid !== callSid || botSpeaking) return;
    stt.sendAudio(payload);
  };
  callManager.on("audio:data", audioHandler);

  // Cleanup on call end
  const endHandler = (session: { callSid: string }) => {
    if (session.callSid !== callSid) return;
    console.log(`[${callSid}] Voice agent cleanup`);
    stt.disconnect();
    callManager.off("audio:data", audioHandler);
    callManager.off("session:ended", endHandler);
    activeAgents.delete(callSid);
  };
  callManager.on("session:ended", endHandler);
}
