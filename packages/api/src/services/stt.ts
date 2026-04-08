import { EventEmitter } from "events";

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
      "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&model=nova-2&punctuate=true&interim_results=true&endpointing=300&utterance_end_ms=1000";

    this.ws = new WebSocket(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    } as any);

    this.ws.onopen = () => this.emit("connected");

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(
          typeof event.data === "string" ? event.data : event.data.toString()
        );

        if (data.type === "Results") {
          const transcript =
            data.channel?.alternatives?.[0]?.transcript || "";
          const isFinal = data.is_final;
          const speechFinal = data.speech_final;

          if (transcript) {
            this.emit("transcript", { transcript, isFinal, speechFinal });
          }
        }

        if (data.type === "UtteranceEnd") {
          this.emit("utterance-end");
        }
      } catch (err) {
        this.emit("error", err);
      }
    };

    this.ws.onerror = (err: Event) => this.emit("error", err);
    this.ws.onclose = () => this.emit("disconnected");
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
