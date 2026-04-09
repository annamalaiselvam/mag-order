import { EventEmitter } from "events";
import WebSocket from "ws";

/**
 * Speech-to-Text service using Deepgram.
 * Accepts base64-encoded mulaw audio from Twilio Media Streams
 * and emits transcription results.
 */
export class SpeechToText extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    const url =
      "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&model=nova-2&punctuate=true&interim_results=true&endpointing=200&utterance_end_ms=1000";

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    this.ws.on("open", () => this.emit("connected"));

    let lastFinalTranscript = "";

    this.ws.on("message", (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        const transcript = parsed.channel?.alternatives?.[0]?.transcript || "";

        if (parsed.type === "Results") {
          // Accumulate final segments
          if (parsed.is_final && transcript) {
            lastFinalTranscript = transcript;
          }
          // Fire immediately if speech_final
          if (parsed.speech_final && transcript) {
            this.emit("transcript", { transcript, isFinal: true, speechFinal: true });
            lastFinalTranscript = "";
          }
        }

        // UtteranceEnd = silence detected, flush whatever we have
        if (parsed.type === "UtteranceEnd") {
          if (lastFinalTranscript) {
            this.emit("transcript", { transcript: lastFinalTranscript, isFinal: true, speechFinal: true });
            lastFinalTranscript = "";
          }
        }
      } catch (err) {
        this.emit("error", err);
      }
    });

    this.ws.on("error", (err) => this.emit("error", err));
    this.ws.on("close", () => this.emit("disconnected"));
  }

  sendAudio(base64Audio: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const buffer = Buffer.from(base64Audio, "base64");
      this.ws.send(buffer);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
