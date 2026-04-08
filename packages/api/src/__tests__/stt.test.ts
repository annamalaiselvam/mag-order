import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpeechToText } from "../services/stt.js";

// Mock WebSocket globally as a proper constructor
const mockWs = {
  send: vi.fn(),
  close: vi.fn(),
  readyState: 1, // OPEN
  onopen: null as any,
  onmessage: null as any,
  onerror: null as any,
  onclose: null as any,
};

function MockWebSocket() {
  mockWs.onopen = null;
  mockWs.onmessage = null;
  mockWs.onerror = null;
  mockWs.onclose = null;
  mockWs.send.mockClear();
  mockWs.close.mockClear();
  return mockWs;
}
MockWebSocket.OPEN = 1;

vi.stubGlobal("WebSocket", MockWebSocket);

describe("SpeechToText", () => {
  let stt: SpeechToText;

  beforeEach(() => {
    stt = new SpeechToText("test_deepgram_key");
    vi.clearAllMocks();
  });

  afterEach(() => {
    stt.removeAllListeners();
    stt.disconnect();
  });

  it("connects to Deepgram WebSocket", async () => {
    // After connect, onopen should be assigned (WebSocket was constructed)
    await stt.connect();
    expect(mockWs.onopen).toBeTypeOf("function");
  });

  it("emits 'connected' when WebSocket opens", async () => {
    const handler = vi.fn();
    stt.on("connected", handler);

    await stt.connect();
    mockWs.onopen();

    expect(handler).toHaveBeenCalledOnce();
  });

  it("emits transcript events for final results", async () => {
    const handler = vi.fn();
    stt.on("transcript", handler);

    await stt.connect();

    const deepgramResult = {
      type: "Results",
      channel: {
        alternatives: [
          { transcript: "I would like to order a grilled salmon" },
        ],
      },
      is_final: true,
      speech_final: true,
    };

    mockWs.onmessage({ data: JSON.stringify(deepgramResult) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual({
      transcript: "I would like to order a grilled salmon",
      isFinal: true,
      speechFinal: true,
    });
  });

  it("emits transcript events for interim results", async () => {
    const handler = vi.fn();
    stt.on("transcript", handler);

    await stt.connect();

    const interimResult = {
      type: "Results",
      channel: {
        alternatives: [{ transcript: "I would like" }],
      },
      is_final: false,
      speech_final: false,
    };

    mockWs.onmessage({ data: JSON.stringify(interimResult) });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].isFinal).toBe(false);
  });

  it("skips empty transcripts", async () => {
    const handler = vi.fn();
    stt.on("transcript", handler);

    await stt.connect();

    const emptyResult = {
      type: "Results",
      channel: { alternatives: [{ transcript: "" }] },
      is_final: true,
      speech_final: true,
    };

    mockWs.onmessage({ data: JSON.stringify(emptyResult) });

    expect(handler).not.toHaveBeenCalled();
  });

  it("emits utterance-end event", async () => {
    const handler = vi.fn();
    stt.on("utterance-end", handler);

    await stt.connect();
    mockWs.onmessage({ data: JSON.stringify({ type: "UtteranceEnd" }) });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("sends audio data to WebSocket", async () => {
    await stt.connect();
    mockWs.readyState = 1; // OPEN

    const base64Audio = Buffer.from("fake mulaw audio").toString("base64");
    stt.sendAudio(base64Audio);

    expect(mockWs.send).toHaveBeenCalledOnce();
    const sentBuffer = mockWs.send.mock.calls[0][0];
    expect(Buffer.isBuffer(sentBuffer)).toBe(true);
    expect(sentBuffer.toString()).toBe("fake mulaw audio");
  });

  it("does not send audio when WebSocket is not open", async () => {
    await stt.connect();
    mockWs.readyState = 3; // CLOSED

    stt.sendAudio(Buffer.from("test").toString("base64"));

    expect(mockWs.send).not.toHaveBeenCalled();
  });

  it("disconnects cleanly", async () => {
    await stt.connect();
    stt.disconnect();

    expect(mockWs.close).toHaveBeenCalledOnce();
  });

  it("emits error on malformed message", async () => {
    const handler = vi.fn();
    stt.on("error", handler);

    await stt.connect();
    mockWs.onmessage({ data: "not json{{{" });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("emits disconnected when WebSocket closes", async () => {
    const handler = vi.fn();
    stt.on("disconnected", handler);

    await stt.connect();
    mockWs.onclose();

    expect(handler).toHaveBeenCalledOnce();
  });
});
