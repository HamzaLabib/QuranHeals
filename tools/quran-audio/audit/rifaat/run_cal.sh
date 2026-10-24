#!/bin/sh
# Calibration: Rifaat audio scored against a WRONG expected surah (neighbour), control another neighbour.
# The share of windows reaching the margin is the false-confirmation rate of the teacher-forced check.
P="${PYTHON:?set PYTHON to the aligner venv python}"
Q="${QURAN:?set QURAN to backend/data/quran/quran-uthmani.txt}"
export TF_MAXSPAN=2 TF_HOP=20
B="audio/rifaat_86.mp3 audio/rifaat_82.mp3 audio/rifaat_87.mp3"
for job in 98:97:99 100:101:102 73:71:74 85:84:86; do
  a=$(echo $job | cut -d: -f1); e=$(echo $job | cut -d: -f2); c=$(echo $job | cut -d: -f3)
  $P -X utf8 tf_verify.py "$Q" model-turbo audio/rifaat_$a.mp3 $e $c tf/cal_audio${a}_as${e}.json $B > tf/cal_$a.log 2>&1 && echo "cal done $a" || echo "cal FAILED $a"
done
echo CAL-DONE
