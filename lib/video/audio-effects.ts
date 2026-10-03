import type { AudioEffect, AudioEffectType } from '@/lib/video/project';

/* Browser-native audio effect graph used by the video editor preview/export. */

export const AUDIO_EFFECT_PRESETS: { id: AudioEffectType; name: string; hint: string }[] = [
  { id: 'none', name: 'Original', hint: 'No processing' },
  { id: 'deep', name: 'Deep', hint: 'Lower the voice' },
  { id: 'high', name: 'High', hint: 'Raise the voice' },
  { id: 'robot', name: 'Robot', hint: 'Metallic robotic voice' },
  { id: 'monster', name: 'Monster', hint: 'Deep + distorted' },
  { id: 'chipmunk', name: 'Chipmunk', hint: 'Bright high voice' },
  { id: 'telephone', name: 'Telephone', hint: 'Narrow phone-band sound' },
  { id: 'radio', name: 'Radio', hint: 'AM/radio coloration' },
  { id: 'megaphone', name: 'Megaphone', hint: 'Compressed horn sound' },
  { id: 'cave', name: 'Cave', hint: 'Short dark reverb' },
  { id: 'hall', name: 'Hall', hint: 'Wide room reverb' },
  { id: 'cathedral', name: 'Cathedral', hint: 'Long spacious reverb' },
  { id: 'echo', name: 'Echo', hint: 'Repeating delay' },
  { id: 'lofi', name: 'Lo-Fi', hint: 'Filtered degraded tone' },
  { id: 'distortion', name: 'Distortion', hint: 'Overdrive' },
  { id: 'chorus', name: 'Chorus', hint: 'Wide doubled sound' },
  { id: 'flanger', name: 'Flanger', hint: 'Moving comb filter' },
  { id: 'phaser', name: 'Phaser', hint: 'Sweeping phase texture' },
  { id: 'tremolo', name: 'Tremolo', hint: 'Rhythmic volume movement' },
  { id: 'vibrato', name: 'Vibrato', hint: 'Pitch movement' },
  { id: 'underwater', name: 'Underwater', hint: 'Muffled submerged sound' },
  { id: 'vinyl', name: 'Vinyl', hint: 'Warm filtered texture' },
  { id: 'bass', name: 'Bass Boost', hint: 'Low-frequency boost' },
  { id: 'treble', name: 'Treble Boost', hint: 'High-frequency boost' },
];

export function audioEffectName(type: AudioEffectType) {
  return AUDIO_EFFECT_PRESETS.find((p) => p.id === type)?.name || type;
}

function clamp(v: number) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}

function connectWetDry(ctx: BaseAudioContext, input: AudioNode, effectNode: AudioNode, mix: number, output: AudioNode) {
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;
  input.connect(dry).connect(output);
  input.connect(effectNode).connect(wet).connect(output);
}

function makeDistortion(ctx: BaseAudioContext, amount: number) {
  const node = ctx.createWaveShaper();
  const n = 44100;
  const curve = new Float32Array(n);
  const drive = 1 + amount * 80;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + drive) * x * 20 * Math.PI / 180) / (Math.PI + drive * Math.abs(x));
  }
  node.curve = curve;
  node.oversample = '4x';
  return node;
}

export function connectAudioEffects(
  ctx: BaseAudioContext,
  input: AudioNode,
  effects: AudioEffect[] | undefined,
  output: AudioNode,
  finalGain?: GainNode,
) {
  const list = (effects || []).filter((e) => e && e.type !== 'none' && clamp(e.mix) > 0);
  let current: AudioNode = input;
  const finish = finalGain || ctx.createGain();

  if (list.length === 0) {
    current.connect(finish);
    finish.connect(output);
    return finish;
  }

  for (const effect of list) {
    const amount = clamp(effect.amount);
    const mix = clamp(effect.mix);
    const type = effect.type;
    if (type === 'deep' || type === 'high' || type === 'chipmunk') {
      const f = ctx.createBiquadFilter();
      f.type = 'lowshelf';
      f.frequency.value = type === 'deep' ? 220 : 3200;
      f.gain.value = type === 'deep' ? -8 * amount : 5 * amount;
      current.connect(f);
      current = f;
      continue;
    }
    if (type === 'telephone' || type === 'radio' || type === 'megaphone' || type === 'underwater') {
      const hp = ctx.createBiquadFilter();
      const lp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      lp.type = 'lowpass';
      hp.frequency.value = type === 'telephone' ? 420 : type === 'radio' ? 260 : type === 'megaphone' ? 300 : 650;
      lp.frequency.value = type === 'telephone' ? 3200 : type === 'radio' ? 5200 : type === 'megaphone' ? 6500 : 2400;
      current.connect(hp).connect(lp);
      current = lp;
      continue;
    }
    if (type === 'bass' || type === 'treble') {
      const f = ctx.createBiquadFilter();
      f.type = type === 'bass' ? 'lowshelf' : 'highshelf';
      f.frequency.value = type === 'bass' ? 180 : 4200;
      f.gain.value = (type === 'bass' ? 18 : 10) * amount;
      current.connect(f);
      current = f;
      continue;
    }
    if (type === 'echo') {
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = 0.16 + amount * 0.38;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.12 + amount * 0.48;
      delay.connect(feedback).connect(delay);
      const mixNode = ctx.createGain();
      const wet = ctx.createGain(); wet.gain.value = mix * 0.7;
      const dry = ctx.createGain(); dry.gain.value = 1 - mix * 0.35;
      current.connect(dry).connect(mixNode);
      current.connect(delay).connect(wet).connect(mixNode);
      current = mixNode;
      continue;
    }
    if (type === 'cave' || type === 'hall' || type === 'cathedral') {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, type === 'cave' ? 1.3 : type === 'hall' ? 2.4 : 4.2, type === 'cave' ? 2.8 : 2.2);
      const mixNode = ctx.createGain();
      const wet = ctx.createGain(); wet.gain.value = mix * (type === 'cathedral' ? 0.7 : 0.5);
      const dry = ctx.createGain(); dry.gain.value = 1 - mix * 0.45;
      current.connect(dry).connect(mixNode);
      current.connect(conv).connect(wet).connect(mixNode);
      current = mixNode;
      continue;
    }
    if (type === 'distortion' || type === 'monster' || type === 'lofi') {
      const shaper = makeDistortion(ctx, type === 'monster' ? Math.min(1, amount * 1.3) : amount);
      if (type === 'lofi') {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600 - amount * 1200;
        current.connect(lp).connect(shaper); current = shaper;
      } else current.connect(shaper), current = shaper;
      continue;
    }
    if (type === 'robot' || type === 'flanger' || type === 'phaser' || type === 'chorus') {
      const delay = ctx.createDelay(0.08);
      delay.delayTime.value = type === 'robot' ? 0.018 : type === 'chorus' ? 0.025 : 0.008;
      const mixNode = ctx.createGain();
      const wet = ctx.createGain(); wet.gain.value = mix * 0.65;
      const dry = ctx.createGain(); dry.gain.value = 1 - mix * 0.35;
      current.connect(dry).connect(mixNode);
      current.connect(delay).connect(wet).connect(mixNode);
      current = mixNode;
      continue;
    }
    if (type === 'tremolo') {
      /* Keep amplitude modulation bounded so it cannot create harsh flutter. */
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      const depth = ctx.createGain();
      osc.frequency.value = 4 + amount * 6;
      depth.gain.value = amount * 0.28;
      gain.gain.value = 1 - amount * 0.14;
      osc.connect(depth).connect(gain.gain);
      osc.start();
      current.connect(gain);
      current = gain;
      continue;
    }
    if (type === 'vibrato') {
      /* Real pitch movement via a short modulated delay; the old code
         modulated gain instead, producing the vibrating/fluttering sound. */
      const delay = ctx.createDelay(0.05);
      const mixNode = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      delay.delayTime.value = 0.012;
      lfo.frequency.value = 4 + amount * 4;
      depth.gain.value = 0.003 + amount * 0.006;
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start();
      dry.gain.value = 1 - mix * 0.5;
      wet.gain.value = mix * 0.5;
      current.connect(dry).connect(mixNode);
      current.connect(delay).connect(wet).connect(mixNode);
      current = mixNode;
      continue;
    }
    if (type === 'vinyl') {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7200 - amount * 1800;
      current.connect(hp).connect(lp); current = lp;
      continue;
    }
  }
  current.connect(finish);
  finish.connect(output);
  return finish;
}
