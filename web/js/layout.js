// How the workbench lays out the sound settings: sections > boxes > settings,
// with labels that read well in that place. Layout only: the settings
// themselves (keys, ranges, defaults) live in blocksound.js and waves.js.
// Any setting missing here still appears, in an "Other" box (see workbench.js).

import { DISTANT_BOXES } from "./waves.js";

export const LAYOUT = [
  {
    section: "Block note",
    boxes: [
      { box: "Oscillators", keys: ["blockOctave", "phaseScramble", "oscAType", "oscBType", "oscBOctave", "oscBDetune", "oscBLevel", "drive"] },
      { box: "Filter (low-pass)", keys: ["cutoff", "strikeCutoff", "filterDecay", "q"] },
      { box: "Pulse (filter sweep)", keys: ["pulseAmount", "pulseShape", "pulseStartRate", "pulseEndRate", "pulseSweepLength", "pulseCurve", "pulseFadeOut", "pulseFadeCurve"] },
      { box: "Amp envelope", keys: ["attack", "decay", "sustain"] },
      { box: "Breath (noise)", keys: ["breathLevel", "breathSustainLevel", "breathFreq", "breathQ", "breathAttack", "breathDecay"] },
      { box: "Chorus", keys: ["chorusMix", "chorusRate", "chorusDepth"] },
      { box: "Vibrato", keys: ["vibratoDepth", "vibratoRate"] },
      { box: "Level & sends", keys: ["level", "reverbMix", "echoSend"], labels: { level: "Start level", reverbMix: "Reverb send", echoSend: "Echo send" } },
    ],
  },
  {
    section: "Transaction notes",
    boxes: [
      { box: "Chime partials", keys: ["partial2", "partial2Decay", "partial3", "partial3Decay", "partial4", "partial4Decay",
        "partial5", "partial5Decay", "partial6", "partial6Decay"] },
      { box: "Pitch movement", keys: ["driftDepth", "driftRate", "noteVibratoDepth", "noteVibratoRate"] },
      { box: "Sends", keys: ["harmonicsSend", "harmonicsEchoSend"], labels: { harmonicsSend: "Reverb send", harmonicsEchoSend: "Echo send" } },
    ],
  },
  {
    section: "Space (shared reverb and echo)",
    boxes: [
      { box: "Reverb", keys: ["reverbSize", "reverbPreDelay", "reverbDecay", "reverbDampFreq", "reverbHfRatio", "reverbDiffusion", "reverbEarly", "reverbWidth"],
        labels: { reverbDecay: "Decay (RT60)" } },
      { box: "Echo", keys: ["echoTime", "echoFeedback", "echoDamping", "echoToReverb"] },
    ],
  },
  {
    section: "Ocean",
    boxes: [
      { box: "All waves", keys: ["wavesLevel", "waveDistance", "wavesReverb"], labels: { wavesReverb: "Reverb send" } },
      { box: "Main waves", keys: ["nearOn", "nearLevel", "waveInterval", "waveIrregularity", "waveSizeVariation", "setSpacing", "setBoost",
        "swellTime", "swellTimeMin", "swellLevel", "breakAttack", "breakAttackMin", "crashLevel", "crashBrightness", "crashBrightnessMin",
        "washTime", "washTimeMin", "washBrightness", "washBrightnessMin", "washDarkening", "fizzLevel", "fizzLevelMin", "fizzFreq",
        "fizzFreqMin", "backwashLevel", "backwashLevelMin", "backwashTime", "backwashTimeMin", "wavePanSpread"], labels: { nearOn: "On", nearLevel: "Level" } },
      ...DISTANT_BOXES, // far and further waves (defined in waves.js)
      { box: "Distant surf bed", keys: ["bedLevel", "bedCutoff"], labels: { bedLevel: "Level", bedCutoff: "Low-pass" } },
    ],
  },
];
