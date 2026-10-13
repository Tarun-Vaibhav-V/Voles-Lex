# VoxLex — a local-first Amazon Lex V2 simulator with an on-device LLM voice agent

> **AWS Service Simulation & Enhancement** · Service simulated: **Amazon Lex V2** (with the Transcribe + Polly pieces a Lex voice bot uses)

VoxLex re-implements the Amazon Lex bot builder console and runtime as a web app: intents, sample utterances, slots and slot types, the Lex dialog state machine, Lambda fulfillment, versions & aliases, a test console and a `RecognizeText`-compatible REST API.

On top of that it adds a **voice agent that runs entirely on your machine**. A local LLM (Gemma 3 via Ollama, or WebLLM in the browser) replaces Lex's utterance-matching NLU, Whisper does speech-to-text in the browser, and the OS voice engine speaks the replies. Nothing is sent to the cloud.

---

## 1. Which Lex features are simulated

| Amazon Lex V2 concept | VoxLex implementation | Where |
|---|---|---|
| Bots (create / list / delete / import) | Bot list with templates and JSON import | `src/pages/BotsList.jsx` |
| Intents + sample utterances with `{Slot}` refs | Intent editor | `src/pages/IntentEditor.jsx` |
| Slots: required/optional, priority, prompts, retries | Slot editor; dialog re-prompts up to 2× then fails | `src/engine/dialog.js` |
| Built-in slot types `AMAZON.Number/Date/Time/City/PhoneNumber/EmailAddress/FirstName/AlphaNumeric/FreeFormInput` | Rule-based resolvers | `src/engine/slotTypes.js` |
| Custom slot types (values + synonyms, *Restrict* / *Expand*) | Exact, synonym and fuzzy (Levenshtein) resolution | `src/engine/slotTypes.js` |
| NLU confidence threshold → `FallbackIntent` | Per-bot threshold slider | `BotSettings.jsx` |
| Dialog management: `ElicitIntent → ElicitSlot → ConfirmIntent → Close` | Full state machine, session attributes, intent switching, built-in cancel | `src/engine/dialog.js` |
| Confirmation prompt / declination response | Supported | |
| Fulfillment Lambda code hook (Lex V2 event/response format) | JS code hook, sandboxed in a Web Worker (browser) or `vm` (server), 3 s timeout, captured logs | `src/engine/lambda.js` |
| Closing response | Supported, with `{Slot}` templating | |
| Versions & aliases (`TestBotAlias` → Draft, `prod` → Version N) | Immutable snapshots, alias routing | `src/pages/Versions.jsx` |
| Test console (text + voice, inspect JSON) | Side panel, shows the `RecognizeText` response | `src/components/TestConsole.jsx` |
| Runtime API `RecognizeText`, `GetSession`, `DeleteSession` | `POST /bots/{id}/botAliases/{alias}/botLocales/{locale}/sessions/{sid}/text` | `server/index.js` |
| Conversation logs (CloudWatch) | Per-turn logs with intent, confidence, latency | `src/pages/Analytics.jsx` |
| Idle session TTL | Session is reset after inactivity | |

## 2. Enhancements beyond AWS

1. **🧠 LLM NLU (zero-shot understanding).** A local LLM reads the bot schema and dialog context and returns intent, confidence and *every* slot it can find, as JSON constrained to a schema. "yo get me two big paneer pizzas around 8 tonight" fills 4 slots in one turn, where classic Lex falls back. An **anti-hallucination guard** rejects slot values that have no evidence in the user's words.
2. **🎙️ On-device voice loop with barge-in.** Mic → energy VAD → **Whisper (transformers.js, WebGPU/WASM)** → bot → OS speech synthesis. Hands-free turn-taking, and you can **interrupt the bot mid-sentence**.
3. **⚖️ Classic vs LLM "Compare" mode.** Every turn shows what stock Lex-style matching would have done.
4. **✨ Describe-a-bot generator.** One sentence produces intents, slots, custom slot types, utterances and prompts. There's also an "Suggest utterances with AI" button on each intent.
5. **🩺 Missed-utterance coach.** The LLM reviews failed turns and proposes which intent each belongs to, as a templated utterance. One click applies it.
6. **💰 Cost & privacy meter.** Each turn is priced at AWS list prices (Lex + Transcribe + Polly + Lambda), with a monthly production projection. It also counts the bytes kept on-device.
7. **📤 Export to real Amazon Lex.** Downloads a **Lex V2 import package (LexJson zip)** that can be imported in the AWS console.

## 3. Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (React + Vite)"]
    UI[Lex-style console] --> ENG
    MIC[Mic + VAD] --> WH[Whisper worker<br/>transformers.js]
    WH --> ENG[Dialog engine<br/>src/engine]
    ENG --> TTS[speechSynthesis<br/>+ barge-in monitor]
    ENG --> LW[Lambda sandbox<br/>Web Worker]
    ENG --> WL[WebLLM<br/>WebGPU, optional]
  end
  ENG -- JSON-schema chat --> OL[(Ollama<br/>gemma3:4b)]
  API[server/index.js<br/>Lex V2 runtime REST] --> ENG2[same engine] --> OL
```

The engine (`src/engine/*`) is plain ES modules with no DOM dependency, so the browser console and the Node REST server share the same code.

## 4. Running locally

```bash
# 1. Local LLM
ollama pull gemma3:4b          # or gemma3:1b / qwen2.5:1.5b on low-RAM machines

# 2. Web app
npm install
npm run dev                    # http://localhost:5173

# 3. (optional) Lex-style REST runtime on :8787
npm run server
curl -X POST localhost:8787/bots/PIZZA/botAliases/TestBotAlias/botLocales/en_US/sessions/s1/text \
     -H 'Content-Type: application/json' -d '{"text":"get me 2 large pepperoni pizzas at 8pm"}'
```

Whisper weights (q8: 41 MB for `tiny.en`, 77 MB for `base.en`) download on first mic use in 2 MB chunks that are retried and **resumed** after a dropped connection or page reload, then cached by the browser. Until the download finishes, the voice loop uses the browser's speech recognition so the mic works right away.

## 5. Deployment (GitHub Pages)

The workflow in `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. Enable it under **Settings → Pages → Source: GitHub Actions**.

The deployed site is static, and the AI still runs on the visitor's own machine:

- **Zero install:** Local AI runtime → *WebLLM (in-browser)*. The model downloads once and runs on WebGPU (Chrome/Edge).
- **With Ollama:** allow the site's origin, then restart Ollama:
  ```bash
  launchctl setenv OLLAMA_ORIGINS "https://<user>.github.io"   # macOS app
  OLLAMA_ORIGINS="https://<user>.github.io" ollama serve        # CLI
  ```
  Chrome may ask for permission to access devices on your local network. Allow it.

## 6. Demo script (≈3 min)

1. **Bots → PizzaBot → Intents.** Walk through intents, slots, custom slot types, and the Lambda in *Fulfillment*.
2. **Test bot → Classic.** Type `order a large pepperoni pizza`. The bot elicits the remaining slots, confirms, and the Lambda creates the order.
3. Still Classic: `yo get me two big paneer pizzas around 8 tonight` → **FallbackIntent**.
4. Switch to **Compare**, then send the same sentence. The LLM fills all 4 slots, and the amber chip shows that Classic would have failed.
5. **🎙️ Mic.** Order by voice, then **talk over the bot** to interrupt it.
6. **Logs & coach** → *Analyse missed* → *Add utterance*.
7. **Cost & privacy** shows the AWS bill avoided. Then **Export to AWS** → download the Lex zip.
8. **Create bot → Describe with AI** → "a clinic receptionist that books appointments…"

## 7. Project structure

```
src/
  engine/        dialog.js (Lex state machine) · classicNlu.js · llmNlu.js · llm.js
                 slotTypes.js · lambda.js · generator.js · coach.js · cost.js · exportLex.js · templates.js
  voice/         voiceAgent.js (VAD, TTS, barge-in) · whisper.worker.js
  pages/         console pages (bots, intents, slot types, versions, fulfillment, logs, export, settings, dashboard)
  components/    TestConsole.jsx · ui.jsx
server/          index.js (Lex V2 runtime REST API) · bots/*.json
```

---
*This is a student project for academic purposes. It is not affiliated with or endorsed by Amazon Web Services. "Amazon Lex" is referenced only to describe the service being simulated.*
