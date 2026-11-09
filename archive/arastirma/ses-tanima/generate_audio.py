import os
import time
import subprocess

VOICES = {
    "ahmet": "tr-TR-AhmetNeural",
    "emel": "tr-TR-EmelNeural"
}

OUTPUT_DIR = r"C:\studio-lab\t4-stt\audio"
CLEAN_DIR = os.path.join(OUTPUT_DIR, "clean")
NOISY_DIR = os.path.join(OUTPUT_DIR, "noisy")
TMP_DIR = os.path.join(OUTPUT_DIR, "tmp")

os.makedirs(CLEAN_DIR, exist_ok=True)
os.makedirs(NOISY_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

with open(r"C:\studio-lab\t4-stt\ref.txt", "r", encoding="utf-8") as f:
    sentences = [line.strip() for line in f if line.strip()]

print(f"Loaded {len(sentences)} sentences.")

EDGE_TTS_BIN = r"C:\studio-lab\t4-stt\venv\Scripts\edge-tts.exe"

def gen_single(text, voice_key, voice_name, idx):
    prefix = f"{idx:02d}_{voice_key}"
    tmp_mp3 = os.path.join(TMP_DIR, f"{prefix}.mp3")
    clean_wav = os.path.join(CLEAN_DIR, f"{prefix}.wav")
    noisy_wav = os.path.join(NOISY_DIR, f"{prefix}.wav")

    # If both wavs already exist and are valid, skip
    if os.path.exists(clean_wav) and os.path.getsize(clean_wav) > 1000 and \
       os.path.exists(noisy_wav) and os.path.getsize(noisy_wav) > 1000:
        print(f"[{prefix}] already exists, skipping.")
        return

    # Call edge-tts CLI with retry
    success = False
    for attempt in range(5):
        try:
            cmd = [EDGE_TTS_BIN, "--voice", voice_name, "--text", text, "--write-media", tmp_mp3]
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            if os.path.exists(tmp_mp3) and os.path.getsize(tmp_mp3) > 1000:
                success = True
                break
        except Exception as e:
            print(f"[{prefix}] attempt {attempt+1} failed: {e}. Retrying in 2s...")
            time.sleep(2)

    if not success:
        raise RuntimeError(f"Failed to generate TTS for {prefix}: {text}")

    # Convert to 16kHz mono 16-bit PCM WAV
    cmd_clean = [
        "ffmpeg", "-y", "-i", tmp_mp3,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        clean_wav
    ]
    subprocess.run(cmd_clean, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Get duration of clean wav
    probe_cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", clean_wav
    ]
    duration = float(subprocess.check_output(probe_cmd).strip())

    # Add background noise: anoisesrc (white/pink noise) mixed with SNR ~15 dB
    # A_noise / A_signal = 10^(-15/20) ~ 0.178
    filter_expr = f"anoisesrc=d={duration}:r=16000:a=0.1 [noise]; [0:a][noise] amix=inputs=2:duration=first:dropout_transition=0:weights='1 0.178':normalize=0"
    cmd_noisy = [
        "ffmpeg", "-y", "-i", clean_wav,
        "-filter_complex", filter_expr,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        noisy_wav
    ]
    subprocess.run(cmd_noisy, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[{prefix}] generated ({duration:.2f}s): {text}")
    time.sleep(0.5)

def main():
    for idx, text in enumerate(sentences, 1):
        for vkey, vname in VOICES.items():
            gen_single(text, vkey, vname, idx)

if __name__ == "__main__":
    main()
