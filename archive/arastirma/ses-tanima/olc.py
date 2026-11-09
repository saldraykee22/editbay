import os
import sys
import re
import json
import time
import wave
import ctypes
import ctypes.wintypes
import subprocess
import argparse

# Windows API for PeakWorkingSetSize
class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ('cb', ctypes.wintypes.DWORD),
        ('PageFaultCount', ctypes.wintypes.DWORD),
        ('PeakWorkingSetSize', ctypes.c_size_t),
        ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
        ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t),
        ('PeakPagefileUsage', ctypes.c_size_t),
    ]

def get_peak_ram_mb(handle) -> float:
    pmc = PROCESS_MEMORY_COUNTERS()
    pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
    res = ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb)
    if res:
        return pmc.PeakWorkingSetSize / (1024 * 1024)
    return 0.0

BASE_DIR = r"C:\studio-lab\t4-stt"
AUDIO_DIR = os.path.join(BASE_DIR, "audio")
REF_FILE = os.path.join(BASE_DIR, "ref.txt")
RESULTS_FILE = os.path.join(BASE_DIR, "results.json")
WHISPER_CLI = os.path.join(BASE_DIR, "whisper_bin", "Release", "whisper-cli.exe")
WHISPER_MODELS_DIR = os.path.join(BASE_DIR, "models", "whisper")
VOSK_MODEL_DIR = os.path.join(BASE_DIR, "models", "vosk", "vosk-model-small-tr-0.3")

def normalize_tr(text: str) -> str:
    if not text:
        return ""
    chars = []
    for c in text:
        if c == 'İ':
            chars.append('i')
        elif c == 'I':
            chars.append('ı')
        else:
            chars.append(c.lower())
    s = ''.join(chars).replace('i̇', 'i')
    s = re.sub(r'[^\w\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def calculate_wer(ref_norm: str, hyp_norm: str) -> float:
    r_words = ref_norm.split()
    h_words = hyp_norm.split()
    if not r_words:
        return 0.0 if not h_words else 1.0
    if not h_words:
        return 1.0

    # Levenshtein distance on words
    dp = [[0] * (len(h_words) + 1) for _ in range(len(r_words) + 1)]
    for i in range(len(r_words) + 1):
        dp[i][0] = i
    for j in range(len(h_words) + 1):
        dp[0][j] = j

    for i in range(1, len(r_words) + 1):
        for j in range(1, len(h_words) + 1):
            if r_words[i - 1] == h_words[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = min(
                    dp[i - 1][j] + 1,      # deletion
                    dp[i][j - 1] + 1,      # insertion
                    dp[i - 1][j - 1] + 1   # substitution
                )
    return dp[len(r_words)][len(h_words)] / len(r_words)

def check_critical_error(idx: int, hyp_text: str) -> bool:
    """
    Returns True if a CRITICAL ERROR is detected.
    Critical components: numbers ('iki'/'2', 'bir buçuk'/'1.5'),
    ordinals ('ilk', 'ikinci', 'üçüncü'), verbs ('kısalt', 'kes', 'taşı', 'kıs', 'indir', 'sil', etc.)
    """
    h = normalize_tr(hyp_text)
    words = h.split()
    w_set = set(words)
    
    def has_any(prefixes):
        return any(any(w.startswith(p) for p in prefixes) for w in words)
    def has_exact(targets):
        return any(t in w_set for t in targets)

    # 1. İkinci klibi iki saniye kısalt.
    if idx == 1:
        ord_ok = has_exact(['ikinci', '2', '2nci', '2ci']) or any(w.startswith('2') for w in words)
        num_ok = has_exact(['iki', '2']) or any(w.startswith('2') for w in words)
        verb_ok = has_any(['kısalt'])
        return not (ord_ok and num_ok and verb_ok)
    # 2. İlk klibin başından bir buçuk saniye kes.
    elif idx == 2:
        ord_ok = has_exact(['ilk', '1', '1inci', '1ci', 'birinci'])
        num_ok = has_exact(['buçuk', '1.5', '1,5']) or ('bir' in w_set and 'buçuk' in w_set) or 'buçuk' in h
        verb_ok = has_any(['kes'])
        return not (ord_ok and num_ok and verb_ok)
    # 3. Son klibi en başa taşı.
    elif idx == 3:
        target_ok = has_exact(['son'])
        pos_ok = has_any(['baş', 'başa'])
        verb_ok = has_any(['taşı'])
        return not (target_ok and pos_ok and verb_ok)
    # 4. Müziğin sesini biraz kıs.
    elif idx == 4:
        target_ok = has_any(['müzik', 'ses'])
        quant_ok = has_exact(['biraz'])
        verb_ok = has_exact(['kıs']) or has_any(['kısın', 'kıssana', 'kısmak'])
        return not (target_ok and quant_ok and verb_ok)
    # 5. Müziği yüzde otuza indir.
    elif idx == 5:
        target_ok = has_any(['müzik'])
        num_ok = has_exact(['otuz', 'otuza', '30']) or 'otuz' in h or '30' in h
        verb_ok = has_any(['indir', 'düşür'])
        return not (target_ok and num_ok and verb_ok)
    # 6. Ortadaki videoyu sil.
    elif idx == 6:
        target_ok = has_any(['orta'])
        verb_ok = has_any(['sil'])
        return not (target_ok and verb_ok)
    # 7. Başa beyaz renkle "Yeni Sezon" yazısı ekle.
    elif idx == 7:
        text_ok = ('yeni' in w_set and 'sezon' in w_set) or 'yeni sezon' in h
        verb_ok = has_any(['ekle'])
        return not (text_ok and verb_ok)
    # 8. Yazıyı üç saniye ekranda tut.
    elif idx == 8:
        num_ok = has_exact(['üç', '3'])
        verb_ok = has_any(['tut'])
        return not (num_ok and verb_ok)
    # 9. Başlığı ekranın altına al.
    elif idx == 9:
        pos_ok = has_any(['alt', 'altına'])
        verb_ok = has_exact(['al']) or has_any(['alsın', 'alın'])
        return not (pos_ok and verb_ok)
    # 10. Son yaptığımı geri al.
    elif idx == 10:
        target_ok = has_exact(['son'])
        verb_ok = ('geri' in w_set and 'al' in w_set) or 'gerial' in h or has_exact(['gerial'])
        return not (target_ok and verb_ok)
    # 11. Üçüncü klibi ikinciyle yer değiştir.
    elif idx == 11:
        ord1_ok = has_exact(['üçüncü', '3']) or any(w.startswith('3') for w in words)
        ord2_ok = has_exact(['ikinci', '2', 'ikinciyle']) or any(w.startswith('2') for w in words)
        verb_ok = has_any(['değiş', 'değiştir'])
        return not (ord1_ok and ord2_ok and verb_ok)
    # 12. Videonun sonuna logoyu ekle.
    elif idx == 12:
        pos_ok = has_any(['son', 'sonuna'])
        target_ok = has_any(['logo'])
        verb_ok = has_any(['ekle'])
        return not (pos_ok and target_ok and verb_ok)
    # 13. Müziği videonun başından başlat.
    elif idx == 13:
        pos_ok = has_any(['baş', 'başından', 'baştan'])
        verb_ok = has_any(['başlat'])
        return not (pos_ok and verb_ok)
    # 14. Klibin sesini tamamen kapat.
    elif idx == 14:
        quant_ok = has_any(['tam', 'tamamen'])
        verb_ok = has_any(['kapat'])
        return not (quant_ok and verb_ok)
    # 15. Yazının rengini sarı yap.
    elif idx == 15:
        color_ok = has_exact(['sarı'])
        verb_ok = has_exact(['yap']) or has_any(['yapın', 'yapsın'])
        return not (color_ok and verb_ok)
    # 16. Toplam süreyi yirmi saniyeye düşür.
    elif idx == 16:
        num_ok = has_exact(['yirmi', '20'])
        verb_ok = has_any(['düşür', 'indir'])
        return not (num_ok and verb_ok)
    # 17. İkinci klibin son iki saniyesini at.
    elif idx == 17:
        ord_ok = has_exact(['ikinci', '2']) or any(w.startswith('2') for w in words)
        num_ok = has_exact(['iki', '2'])
        verb_ok = has_exact(['at']) or has_any(['atın', 'atsın'])
        return not (ord_ok and num_ok and verb_ok)
    # 18. Arka plan müziğini değiştir.
    elif idx == 18:
        target_ok = has_any(['arka', 'plan', 'müzik'])
        verb_ok = has_any(['değiş', 'değiştir'])
        return not (target_ok and verb_ok)
    # 19. Videoyu dikey olarak dışa aktar.
    elif idx == 19:
        param_ok = has_any(['dikey'])
        verb_ok = has_any(['aktar'])
        return not (param_ok and verb_ok)
    # 20. Az önce sildiğim klibi geri getir.
    elif idx == 20:
        target_ok = has_any(['sil', 'sildiğim', 'önce'])
        verb_ok = ('geri' in w_set and 'getir' in w_set) or 'gerigetir' in h
        return not (target_ok and verb_ok)
    return False

def get_audio_duration(wav_path: str) -> float:
    with wave.open(wav_path, 'rb') as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        return frames / float(rate)

def get_model_size_mb(model_key: str) -> float:
    if model_key == "vosk-small-tr":
        total = 0
        for root, dirs, files in os.walk(VOSK_MODEL_DIR):
            for f in files:
                total += os.path.getsize(os.path.join(root, f))
        return total / (1024 * 1024)
    elif model_key == "whisper-tiny":
        p = os.path.join(WHISPER_MODELS_DIR, "ggml-tiny.bin")
        return os.path.getsize(p) / (1024 * 1024)
    elif model_key == "whisper-base":
        p = os.path.join(WHISPER_MODELS_DIR, "ggml-base.bin")
        return os.path.getsize(p) / (1024 * 1024)
    elif model_key == "whisper-small":
        p = os.path.join(WHISPER_MODELS_DIR, "ggml-small.bin")
        return os.path.getsize(p) / (1024 * 1024)
    elif model_key == "whisper-large-v3-turbo":
        p = os.path.join(WHISPER_MODELS_DIR, "ggml-large-v3-turbo-q5_0.bin")
        return os.path.getsize(p) / (1024 * 1024)
    return 0.0

def run_vosk_condition(wav_files, refs):
    """Run Vosk on a batch of files in a dedicated worker process for isolated memory & timing measurement."""
    import tempfile
    
    worker_script = os.path.join(BASE_DIR, "_vosk_worker.py")
    with open(worker_script, "w", encoding="utf-8") as wf:
        wf.write('''
import sys, os, json, time, wave, vosk

model_dir = sys.argv[1]
wav_list_file = sys.argv[2]
out_json_file = sys.argv[3]

with open(wav_list_file, "r", encoding="utf-8") as f:
    wavs = [l.strip() for l in f if l.strip()]

t0 = time.perf_counter()
model = vosk.Model(model_dir)
load_time = time.perf_counter() - t0

results = []
infer_t0 = time.perf_counter()
for wav_path in wavs:
    rec = vosk.KaldiRecognizer(model, 16000)
    w_t0 = time.perf_counter()
    with wave.open(wav_path, "rb") as wf:
        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            rec.AcceptWaveform(data)
    res = json.loads(rec.FinalResult())
    dur = time.perf_counter() - w_t0
    results.append({
        "wav": wav_path,
        "text": res.get("text", ""),
        "infer_time": dur
    })

infer_total = time.perf_counter() - infer_t0

with open(out_json_file, "w", encoding="utf-8") as f:
    json.dump({
        "load_time": load_time,
        "total_infer_time": infer_total,
        "items": results
    }, f, ensure_ascii=False)
''')

    wav_list_tmp = os.path.join(BASE_DIR, "_vosk_wavs.txt")
    out_json_tmp = os.path.join(BASE_DIR, "_vosk_out.json")
    with open(wav_list_tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(wav_files) + "\n")

    py_exe = sys.executable
    cmd = [py_exe, worker_script, VOSK_MODEL_DIR, wav_list_tmp, out_json_tmp]
    
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc.wait()
    wall_time = time.perf_counter() - t0
    peak_ram = get_peak_ram_mb(proc._handle)

    with open(out_json_tmp, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Clean up temp worker files
    for tmp in [worker_script, wav_list_tmp, out_json_tmp]:
        if os.path.exists(tmp):
            try: os.remove(tmp)
            except: pass

    return data["items"], data["total_infer_time"], peak_ram

def run_whisper_condition(model_file, wav_files, refs):
    """Run whisper-cli on a batch of files in a single invocation."""
    cmd = [
        WHISPER_CLI,
        "-m", model_file,
        "-l", "tr",
        "-nt",
        "-t", "6",
        "-otxt"
    ]
    # If large-v3-turbo, use greedy decoding for reasonable evaluation runtime
    if "large-v3-turbo" in model_file:
        cmd.extend(["-bs", "1", "-bo", "1"])
        
    cmd.extend(wav_files)

    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc.wait()
    wall_time = time.perf_counter() - t0
    peak_ram = get_peak_ram_mb(proc._handle)

    items = []
    for wav_path in wav_files:
        txt_path = wav_path + ".txt"
        text = ""
        if os.path.exists(txt_path):
            with open(txt_path, "r", encoding="utf-8") as f:
                text = f.read().strip()
            try: os.remove(txt_path)
            except: pass
        items.append({
            "wav": wav_path,
            "text": text,
            "infer_time": wall_time / len(wav_files) # average per file
        })

    return items, wall_time, peak_ram

def main():
    parser = argparse.ArgumentParser(description="STT Benchmark Evaluation")
    parser.add_argument("--models", nargs="+", default=["vosk-small-tr", "whisper-tiny", "whisper-base", "whisper-small", "whisper-large-v3-turbo"],
                        help="List of models to benchmark")
    parser.add_argument("--conditions", nargs="+", default=["clean_ahmet", "clean_emel", "noisy_ahmet", "noisy_emel"],
                        help="List of conditions to benchmark")
    args = parser.parse_args()

    # Load references
    with open(REF_FILE, "r", encoding="utf-8") as f:
        refs = [l.strip() for l in f if l.strip()]

    print(f"Loaded {len(refs)} reference sentences.")

    # Prepare conditions
    condition_wavs = {
        "clean_ahmet": [os.path.join(AUDIO_DIR, "clean", f"{i:02d}_ahmet.wav") for i in range(1, 21)],
        "clean_emel":  [os.path.join(AUDIO_DIR, "clean", f"{i:02d}_emel.wav")  for i in range(1, 21)],
        "noisy_ahmet": [os.path.join(AUDIO_DIR, "noisy", f"{i:02d}_ahmet.wav") for i in range(1, 21)],
        "noisy_emel":  [os.path.join(AUDIO_DIR, "noisy", f"{i:02d}_emel.wav")  for i in range(1, 21)],
    }

    # Audio durations
    condition_durations = {}
    for c_name, wav_list in condition_wavs.items():
        condition_durations[c_name] = sum(get_audio_duration(w) for w in wav_list)
        print(f"Condition [{c_name}]: {len(wav_list)} files, {condition_durations[c_name]:.2f}s total audio.")

    whisper_model_map = {
        "whisper-tiny": os.path.join(WHISPER_MODELS_DIR, "ggml-tiny.bin"),
        "whisper-base": os.path.join(WHISPER_MODELS_DIR, "ggml-base.bin"),
        "whisper-small": os.path.join(WHISPER_MODELS_DIR, "ggml-small.bin"),
        "whisper-large-v3-turbo": os.path.join(WHISPER_MODELS_DIR, "ggml-large-v3-turbo-q5_0.bin"),
    }

    # Load existing results if any
    all_results = {}
    if os.path.exists(RESULTS_FILE):
        try:
            with open(RESULTS_FILE, "r", encoding="utf-8") as f:
                all_results = json.load(f)
        except:
            all_results = {}

    all_transcriptions = []

    print("\nStarting benchmark execution...")
    for model_key in args.models:
        print(f"\n==================================================")
        print(f"MODEL: {model_key} (Size: {get_model_size_mb(model_key):.1f} MB)")
        print(f"==================================================")
        
        if model_key not in all_results:
            all_results[model_key] = {
                "size_mb": get_model_size_mb(model_key),
                "conditions": {}
            }

        for cond_key in args.conditions:
            # Check if condition already done
            if cond_key in all_results[model_key]["conditions"]:
                print(f"[{model_key} | {cond_key}] Already evaluated, loading from cache.")
                # populate transcriptions for worst report
                cond_data = all_results[model_key]["conditions"][cond_key]
                all_transcriptions.extend(cond_data["items"])
                continue

            wav_list = condition_wavs[cond_key]
            total_audio_dur = condition_durations[cond_key]
            print(f"\nRunning [{model_key} | {cond_key}] ({len(wav_list)} files, {total_audio_dur:.1f}s audio)...")
            
            t0 = time.time()
            if model_key == "vosk-small-tr":
                items, infer_time, peak_ram = run_vosk_condition(wav_list, refs)
            else:
                m_file = whisper_model_map[model_key]
                items, infer_time, peak_ram = run_whisper_condition(m_file, wav_list, refs)
            
            elapsed = time.time() - t0
            rtf = infer_time / total_audio_dur

            # Evaluate metrics per sentence
            eval_items = []
            total_wer = 0.0
            crit_errors = 0

            for idx, (it, ref_raw) in enumerate(zip(items, refs), 1):
                hyp_raw = it["text"]
                ref_norm = normalize_tr(ref_raw)
                hyp_norm = normalize_tr(hyp_raw)
                wer = calculate_wer(ref_norm, hyp_norm)
                is_crit = check_critical_error(idx, hyp_raw)
                if is_crit:
                    crit_errors += 1
                total_wer += wer

                eval_item = {
                    "model": model_key,
                    "condition": cond_key,
                    "idx": idx,
                    "wav": os.path.basename(it["wav"]),
                    "ref": ref_raw,
                    "ref_norm": ref_norm,
                    "hyp": hyp_raw,
                    "hyp_norm": hyp_norm,
                    "wer": wer,
                    "critical_error": is_crit
                }
                eval_items.append(eval_item)
                all_transcriptions.append(eval_item)

            avg_wer = total_wer / len(refs)

            print(f"[{model_key} | {cond_key}] Done in {elapsed:.1f}s | Infer: {infer_time:.1f}s | RTF: {rtf:.3f} | RAM: {peak_ram:.1f} MB | WER: {avg_wer*100:.2f}% | Kritik Hata: {crit_errors}/20")

            all_results[model_key]["conditions"][cond_key] = {
                "infer_time_sec": infer_time,
                "audio_duration_sec": total_audio_dur,
                "rtf": rtf,
                "peak_ram_mb": peak_ram,
                "wer": avg_wer,
                "critical_errors": crit_errors,
                "items": eval_items
            }

            # Save progress immediately
            with open(RESULTS_FILE, "w", encoding="utf-8") as f:
                json.dump(all_results, f, ensure_ascii=False, indent=2)

    # Print summary table
    print("\n\n" + "="*80)
    print("SONUÇ TABLOSU (Aday × Koşul)")
    print("="*80)
    print(f"{'Aday':<22} | {'Koşul':<14} | {'WER (%)':<8} | {'Kritik':<7} | {'RTF':<7} | {'Boyut (MB)':<10} | {'RAM (MB)':<9}")
    print("-" * 88)

    for m_key in args.models:
        if m_key not in all_results: continue
        m_size = all_results[m_key]["size_mb"]
        for c_key in args.conditions:
            if c_key not in all_results[m_key]["conditions"]: continue
            c_data = all_results[m_key]["conditions"][c_key]
            print(f"{m_key:<22} | {c_key:<14} | {c_data['wer']*100:>7.2f}% | {c_data['critical_errors']:>2}/20  | {c_data['rtf']:>6.3f} | {m_size:>9.1f} | {c_data['peak_ram_mb']:>8.1f}")

    # Top 5 worst transcriptions
    print("\n\n" + "="*80)
    print("EN KÖTÜ 5 TRANSKRİPT ÖRNEĞİ")
    print("="*80)
    # Sort transcriptions by wer descending, then critical error
    sorted_bad = sorted(all_transcriptions, key=lambda x: (x["critical_error"], x["wer"]), reverse=True)
    seen_examples = set()
    worst_5 = []
    for item in sorted_bad:
        key = (item["model"], item["condition"], item["idx"])
        if key not in seen_examples:
            seen_examples.add(key)
            worst_5.append(item)
            if len(worst_5) == 5:
                break

    for i, w in enumerate(worst_5, 1):
        print(f"\n{i}. Model: {w['model']} | Koşul: {w['condition']} | Cümle #{w['idx']} ({w['wav']})")
        print(f"   Referans : \"{w['ref']}\"")
        print(f"   Hipotez  : \"{w['hyp']}\"")
        print(f"   WER: {w['wer']*100:.1f}% | Kritik Hata: {'EVET' if w['critical_error'] else 'HAYIR'}")

    print("\nBenchmark tamamlandı. Sonuçlar results.json dosyasına yazıldı.")

if __name__ == "__main__":
    main()
