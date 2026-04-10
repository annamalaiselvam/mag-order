import { EventEmitter } from "events";
import WebSocket from "ws";

export class SpeechToText extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private active = true;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    if (!this.active) return;

    const url =
      "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&model=nova-2&language=en-IN&punctuate=true&interim_results=true&endpointing=500&utterance_end_ms=1000";

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    this.ws.on("open", () => {
      this.keepAliveTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8000);
      this.emit("connected");
    });

    let lastFinalTranscript = "";
    let finalDebounce: ReturnType<typeof setTimeout> | null = null;

    const emitTranscript = (transcript: string) => {
      if (finalDebounce) { clearTimeout(finalDebounce); finalDebounce = null; }
      if (transcript) {
        this.emit("transcript", { transcript, isFinal: true, speechFinal: true });
      }
      lastFinalTranscript = "";
    };

    this.ws.on("message", (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        const transcript = parsed.channel?.alternatives?.[0]?.transcript || "";

        if (parsed.type === "Results") {
          // speech_final = authoritative end of utterance — emit immediately
          if (parsed.speech_final && transcript) {
            emitTranscript(transcript);
            return;
          }

          if (parsed.is_final && transcript) {
            lastFinalTranscript = transcript;

            // Debounce: emit after 150ms if no new is_final or speech_final arrives.
            // This avoids waiting the full utterance_end_ms (1000ms) for UtteranceEnd.
            if (finalDebounce) clearTimeout(finalDebounce);
            finalDebounce = setTimeout(() => {
              if (lastFinalTranscript) {
                emitTranscript(lastFinalTranscript);
              }
            }, 150);
          }
        }

        if (parsed.type === "UtteranceEnd") {
          // UtteranceEnd fires after utterance_end_ms of silence — emit whatever we have
          if (lastFinalTranscript) {
            emitTranscript(lastFinalTranscript);
          } else if (finalDebounce) {
            clearTimeout(finalDebounce);
            finalDebounce = null;
          }
        }
      } catch (err) {
        this.emit("error", err);
      }
    });

    this.ws.on("error", (err) => this.emit("error", err));

    this.ws.on("close", (code, reason) => {
      if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
      if (finalDebounce) { clearTimeout(finalDebounce); finalDebounce = null; }
      if (this.active && code !== 1000) {
        console.warn(`[STT] Deepgram closed (${code} ${reason}) — reconnecting in 500ms`);
        setTimeout(() => this.connect(), 500);
      } else {
        this.emit("disconnected");
      }
    });
  }

  sendAudio(base64Audio: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(Buffer.from(base64Audio, "base64"));
    }
  }

  disconnect(): void {
    this.active = false;
    if (this.keepAliveTimer) { clearInterval(this.keepAliveTimer); this.keepAliveTimer = null; }
    if (this.ws) {
      this.ws.close(1000, "call ended");
      this.ws = null;
    }
  }
}
