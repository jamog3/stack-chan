// Post-processes generated speech-part wav files to reduce the audible click
// heard when AudioOut opens/closes the I2S channel at the start and end of a
// playSequence() run (see host/modules/audio/tts-local.ts). Applies a short
// linear fade-in/fade-out to the PCM data and appends a little silence, so
// the channel closes on (near-)zero amplitude instead of mid-waveform.

import fs from 'fs'
import path from 'path'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

function readWav(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath}: not a RIFF/WAVE file`)
  }
  let offset = 12
  let fmt
  let dataOffset
  let dataLength
  while (offset < buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const bodyOffset = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(bodyOffset),
        numChannels: buffer.readUInt16LE(bodyOffset + 2),
        sampleRate: buffer.readUInt32LE(bodyOffset + 4),
        bitsPerSample: buffer.readUInt16LE(bodyOffset + 14),
      }
    } else if (chunkId === 'data') {
      dataOffset = bodyOffset
      dataLength = chunkSize
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2)
  }
  if (!fmt || dataOffset === undefined) throw new Error(`${filePath}: missing fmt/data chunk`)
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(
      `${filePath}: only 16-bit PCM is supported (got format=${fmt.audioFormat}, bits=${fmt.bitsPerSample})`,
    )
  }
  return {
    fmt,
    header: buffer.subarray(0, dataOffset),
    pcm: buffer.subarray(dataOffset, dataOffset + dataLength),
  }
}

function writeWav(filePath, header, pcm) {
  const totalDataLength = pcm.length
  const out = Buffer.concat([header, pcm])
  // Patch RIFF chunk size (bytes 4-8) and data chunk size (last 4 bytes of header - 4).
  out.writeUInt32LE(out.length - 8, 4)
  out.writeUInt32LE(totalDataLength, header.length - 4)
  fs.writeFileSync(filePath, out)
}

function applyFade(pcm, numChannels, sampleRate, fadeInMs, fadeOutMs, paddingMs) {
  const bytesPerFrame = 2 * numChannels
  const frameCount = Math.floor(pcm.length / bytesPerFrame)
  const fadeInFrames = Math.min(frameCount, Math.round((fadeInMs / 1000) * sampleRate))
  const fadeOutFrames = Math.min(frameCount, Math.round((fadeOutMs / 1000) * sampleRate))
  const paddingFrames = Math.round((paddingMs / 1000) * sampleRate)

  const result = Buffer.from(pcm)
  for (let frame = 0; frame < fadeInFrames; frame++) {
    const gain = frame / fadeInFrames
    for (let ch = 0; ch < numChannels; ch++) {
      const byteOffset = frame * bytesPerFrame + ch * 2
      const sample = result.readInt16LE(byteOffset)
      result.writeInt16LE(Math.round(sample * gain), byteOffset)
    }
  }
  for (let frame = 0; frame < fadeOutFrames; frame++) {
    const gain = frame / fadeOutFrames
    const targetFrame = frameCount - 1 - frame
    for (let ch = 0; ch < numChannels; ch++) {
      const byteOffset = targetFrame * bytesPerFrame + ch * 2
      const sample = result.readInt16LE(byteOffset)
      result.writeInt16LE(Math.round(sample * gain), byteOffset)
    }
  }

  const padding = Buffer.alloc(paddingFrames * bytesPerFrame, 0)
  return Buffer.concat([result, padding])
}

function processFile(filePath, options) {
  const { fmt, header, pcm } = readWav(filePath)
  const faded = applyFade(pcm, fmt.numChannels, fmt.sampleRate, options.fadeIn, options.fadeOut, options.padding)
  writeWav(filePath, header, faded)
  console.log(`faded ${path.basename(filePath)} (${fmt.sampleRate}Hz, ${fmt.numChannels}ch)`)
}

function main() {
  const argv = yargs(hideBin(process.argv))
    .option('dir', { type: 'string', demandOption: true, describe: 'Directory of .wav files to process' })
    .option('fade-in', { type: 'number', default: 5, describe: 'Fade-in duration in ms' })
    .option('fade-out', { type: 'number', default: 15, describe: 'Fade-out duration in ms' })
    .option('padding', { type: 'number', default: 30, describe: 'Trailing silence to append in ms' })
    .parseSync()

  const dir = path.resolve(argv.dir)
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.wav'))
  if (files.length === 0) {
    console.log(`no .wav files found in ${dir}`)
    return
  }
  for (const file of files) {
    processFile(path.join(dir, file), { fadeIn: argv['fade-in'], fadeOut: argv['fade-out'], padding: argv.padding })
  }
  console.log(`done: ${files.length} file(s)`)
}

main()
