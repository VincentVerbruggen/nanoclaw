/**
 * Local voice transcription using whisper.cpp
 *
 * Transcribes audio files using the whisper-cli binary (from Homebrew whisper-cpp).
 * Runs entirely on-device — no API key, no network, no cost.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');

/**
 * Convert an audio file to 16kHz mono WAV (required by whisper.cpp).
 * Returns the path to the converted file.
 */
async function convertToWav(inputPath: string): Promise<string> {
  const wavPath = inputPath + '.wav';
  await execFileAsync('ffmpeg', [
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-f',
    'wav',
    '-y',
    wavPath,
  ]);
  return wavPath;
}

/**
 * Transcribe an audio file using local whisper.cpp.
 * Accepts any audio format — converts to WAV internally.
 * Returns the transcript text, or null on failure.
 */
export async function transcribeAudio(
  audioPath: string,
): Promise<string | null> {
  let wavPath: string | null = null;

  try {
    if (!fs.existsSync(WHISPER_MODEL)) {
      logger.error(
        { model: WHISPER_MODEL },
        'Whisper model not found — cannot transcribe',
      );
      return null;
    }

    // Convert to WAV format for whisper.cpp
    wavPath = await convertToWav(audioPath);

    // Run whisper-cli
    const { stdout } = await execFileAsync(
      WHISPER_BIN,
      ['-m', WHISPER_MODEL, '-f', wavPath, '--no-timestamps', '-nt'],
      { timeout: 60000 },
    );

    const transcript = stdout.trim();
    if (!transcript) {
      logger.warn({ audioPath }, 'Whisper returned empty transcript');
      return null;
    }

    logger.info(
      { audioPath, length: transcript.length },
      'Transcribed voice message',
    );
    return transcript;
  } catch (err) {
    logger.error({ err, audioPath }, 'whisper.cpp transcription failed');
    return null;
  } finally {
    // Clean up temp WAV
    if (wavPath && fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }
  }
}
