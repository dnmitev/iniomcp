/**
 * Audio durations for each slide (in seconds)
 * These should be updated after generating new audio files
 * 
 * To regenerate: run `bash scripts/tts.sh` and then update this file with:
 * for f in audio/*.wav; do echo "  $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f"), // $(basename $f)"; done
 */
export const audioDurations: Record<string, number> = {
  '01-the-problem': 2.0,
  '02-who-benefits': 7.0,
  '03-simple-setup': 4.3,
  '04-privacy-automatic': 3.5,
  '05-ask-in-plain-language': 5.2,
  '06-safe-defaults': 2.8,
  '07-built-for-trust': 6.1,
  '08-whats-next': 4.0,
  '09-current-limits': 3.3,
  '10-risks-and-mitigations': 5.5,
  '11-asks': 2.5,
};
