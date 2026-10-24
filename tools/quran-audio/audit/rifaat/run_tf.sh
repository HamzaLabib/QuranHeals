#!/bin/sh
# Teacher-forced check over the Rifaat recordings labelled complete (shortest first). Control surah: a neighbour.
P="${PYTHON:?set PYTHON to the aligner venv python}"
Q="${QURAN:?set QURAN to backend/data/quran/quran-uthmani.txt}"
export TF_MAXSPAN=2 TF_HOP=20
for job in 1:113 100:101 86:85 96:95 85:84 89:90 82:81 87:86 79:80 75:74 88:87 73:74 83:84 78:77 76:77 72:71 55:56; do
  s=${job%%:*}; c=${job##*:}
  [ -s tf/$s.json ] && [ "$s" != 98 ] && continue
  case $s in 82|86|87) B="audio/rifaat_96.mp3 audio/rifaat_100.mp3 audio/rifaat_79.mp3";; *) B="audio/rifaat_86.mp3 audio/rifaat_82.mp3 audio/rifaat_87.mp3";; esac
  $P -X utf8 tf_verify.py "$Q" model-turbo audio/rifaat_$s.mp3 $s $c tf/$s.json $B > tf/$s.log 2>&1 && echo "done $s" || echo "FAILED $s"
done
echo ALL-DONE
