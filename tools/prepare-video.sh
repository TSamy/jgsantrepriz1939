#!/usr/bin/env bash
# Encode real Anguilla rostrata footage into the hero video files.
# Usage: tools/prepare-video.sh <source-video> [landscape-crop-y]
#   landscape-crop-y: vertical offset (px) of the 3:2 landscape band in a
#   portrait source (default: centered). Ignored for landscape sources.
# Produces assets/video/civelles-portrait.mp4 and civelles-landscape.mp4.
# The poster image is NOT generated: use the image supplied by the company.
set -euo pipefail

src="${1:?Usage: $0 <source-video> [landscape-crop-y]}"
out="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/assets/video}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (sudo apt install ffmpeg)"; exit 1; }

# Display size after rotation
dims=$(ffmpeg -v info -i "$src" -frames:v 1 -vf showinfo -f null - 2>&1 | grep -oE 's:[0-9]+x[0-9]+' | head -1 || true)
[[ -n "$dims" ]] || { echo "Could not read video dimensions"; exit 1; }
dims=${dims#s:}; w=${dims%x*}; h=${dims#*x}
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
x=1  # crossfade seconds for a seamless loop
end=$(echo "$dur - $x" | bc -l)
echo "Source: ${w}x${h}, ${dur}s"

loop="[0:v]split=3[a][b][c];[a]trim=start=$x:end=$end,setpts=PTS-STARTPTS[mid];\
[b]trim=start=$end:end=$dur,setpts=PTS-STARTPTS[tail];[c]trim=start=0:end=$x,setpts=PTS-STARTPTS[head];\
[tail][head]xfade=transition=fade:duration=$x:offset=0[xf];[mid][xf]concat=n=2:v=1:a=0"

# Never upscale: cap to 1080 px on the short side
if (( w < h )); then   # portrait source
  pw=$(( w > 1080 ? 1080 : w )); pw=$(( pw / 2 * 2 ))
  pscale="scale=${pw}:-2"
  lh=$(( w * 2 / 3 / 2 * 2 )); cy="${2:-$(( (h - lh) / 2 ))}"
  lcrop="crop=${w}:${lh}:0:${cy},scale='min(iw,1620)':-2"
else                   # landscape source
  lh=$(( h > 1080 ? 1080 : h )); lh=$(( lh / 2 * 2 ))
  lcrop="scale=-2:${lh}"
  pw=$(( h * 9 / 16 / 2 * 2 ))
  pscale="crop=${pw}:${h},scale='min(iw,1080)':-2"
fi

# Bitrate caps scaled to output size (short side): small sources need far less
rate() { local px=$1; if (( px <= 360 )); then echo 650; elif (( px <= 540 )); then echo 900; elif (( px <= 720 )); then echo 1600; else echo 2800; fi; }
prate=$(rate "$pw"); lrate=$(rate "$lh")

enc=(-an -c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p
     -movflags +faststart -g 60 -map_metadata -1 -crf 26)

echo "→ portrait";  ffmpeg -v error -y -i "$src" -filter_complex "$loop,$pscale,format=yuv420p[v]" -map "[v]" "${enc[@]}" -maxrate ${prate}k -bufsize $((prate*2))k "$out/civelles-portrait.mp4"
echo "→ landscape"; ffmpeg -v error -y -i "$src" -filter_complex "$loop,$lcrop,format=yuv420p[v]"  -map "[v]" "${enc[@]}" -maxrate ${lrate}k -bufsize $((lrate*2))k "$out/civelles-landscape.mp4"

ls -lh "$out"/civelles-*.mp4
echo "Done. Poster: add the company-supplied image as assets/video/civelles-poster.jpg and set data-poster in index.html."
