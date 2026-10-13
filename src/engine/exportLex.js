// Export a VoxLex bot as an Amazon Lex V2 import package (LexJson zip),
// importable via Lex console → Bots → Action → Import.
import JSZip from 'jszip';

const msg = (text) => ({ messageGroupsList: [{ message: { plainTextMessage: { value: text } }, variations: null }], maxRetries: 2, allowInterrupt: true });
const resp = (text) => ({ messageGroupsList: [{ message: { plainTextMessage: { value: text } }, variations: null }], allowInterrupt: true });
const safe = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_');

export function toLexJson(bot) {
  const files = {};
  const root = safe(bot.name);
  const loc = `${root}/BotLocales/${bot.locale || 'en_US'}`;
  files['Manifest.json'] = { metadata: { schemaVersion: '1', resourceType: 'BOT', fileFormat: 'LexJson' } };
  files[`${root}/Bot.json`] = {
    name: bot.name, version: 'DRAFT', description: bot.description || null, identifier: null,
    dataPrivacy: { childDirected: false }, idleSessionTTLInSeconds: bot.idleSessionTTL || 300,
  };
  files[`${loc}/BotLocale.json`] = {
    name: 'English (US)', identifier: bot.locale || 'en_US', version: null, description: null,
    voiceSettings: { voiceId: bot.voice || 'Joanna', engine: 'neural' },
    nluConfidenceThreshold: bot.nluThreshold ?? 0.4,
  };

  for (const t of bot.slotTypes) {
    files[`${loc}/SlotTypes/${safe(t.name)}/SlotType.json`] = {
      name: t.name, identifier: null, description: t.description || null, parentSlotTypeSignature: null,
      slotTypeValues: t.values.map((v) => ({ sampleValue: { value: v.value }, synonyms: (v.synonyms || []).length ? v.synonyms.map((s) => ({ value: s })) : null })),
      valueSelectionSetting: { resolutionStrategy: t.resolution === 'expand' ? 'OriginalValue' : 'TopResolution', regexFilter: null, advancedRecognitionSetting: null },
    };
  }

  for (const i of bot.intents) {
    const base = `${loc}/Intents/${safe(i.name)}`;
    files[`${base}/Intent.json`] = {
      name: i.name, identifier: null, description: i.description || null, parentIntentSignature: null,
      sampleUtterances: i.utterances.map((u) => ({ utterance: u })),
      intentConfirmationSetting: i.confirmationPrompt ? {
        promptSpecification: msg(i.confirmationPrompt),
        declinationResponse: resp(i.declinationResponse || 'Okay, cancelled.'),
        active: true,
      } : null,
      intentClosingSetting: i.closingResponse ? { closingResponse: resp(i.closingResponse), active: true } : null,
      fulfillmentCodeHook: { enabled: !!i.fulfillmentEnabled, active: true, postFulfillmentStatusSpecification: null },
      dialogCodeHook: null, initialResponseSetting: null, inputContexts: null, outputContexts: null, kendraConfiguration: null,
      slotPriorities: i.slots.map((s, n) => ({ priority: n + 1, slotName: s.name })),
    };
    for (const s of i.slots) {
      files[`${base}/Slots/${safe(s.name)}/Slot.json`] = {
        name: s.name, identifier: null, description: null, multipleValuesSetting: null, obfuscationSetting: null,
        slotTypeName: s.type,
        valueElicitationSetting: { slotConstraint: s.required ? 'Required' : 'Optional', promptSpecification: msg(s.prompt || `What is the ${s.name}?`), sampleUtterances: null, waitAndContinueSpecification: null },
      };
    }
  }

  files[`${loc}/Intents/FallbackIntent/Intent.json`] = {
    name: 'FallbackIntent', identifier: 'FALLBCKINT', description: 'Default intent when no other intent matches',
    parentIntentSignature: 'AMAZON.FallbackIntent', sampleUtterances: null, intentConfirmationSetting: null,
    intentClosingSetting: { closingResponse: resp(bot.fallbackMessage || "Sorry, I didn't understand."), active: true },
    fulfillmentCodeHook: null, dialogCodeHook: null, slotPriorities: null,
  };
  return files;
}

export async function downloadLexZip(bot) {
  const zip = new JSZip();
  for (const [path, json] of Object.entries(toLexJson(bot))) zip.file(path, JSON.stringify(json, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safe(bot.name)}-LexJson.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadJSON(obj, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
