import androidx.media3.common.C;
import androidx.media3.common.DataReader;
import androidx.media3.common.Format;
import androidx.media3.common.util.ParsableByteArray;
import androidx.media3.extractor.DefaultExtractorInput;
import androidx.media3.extractor.ExtractorOutput;
import androidx.media3.extractor.PositionHolder;
import androidx.media3.extractor.SeekMap;
import androidx.media3.extractor.TrackOutput;
import androidx.media3.extractor.mp3.Mp3Extractor;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;

/**
 * Runs the real androidx.media3 1.9.0 Mp3Extractor (default flags, as expo-audio's ProgressiveMediaSource) on a file:
 * for each target time, the byte position its SeekMap returns (first seek point, as SeekParameters.EXACT uses), then
 * the label (timeUs) and byte start of the first frame the extractor outputs after seeking there.
 * usage: java SeekProbe <file.mp3> <targetMs> [...]   prints: seeker kind, duration, then "target label_us frame_start".
 */
public final class SeekProbe {
  /** A virtual stream: `prefix` (in memory) then `file` from `fileStart` on - the original bytes, unmodified. */
  static byte[] prefix = new byte[0];
  static long fileStart = 0;
  static final class FileReader implements DataReader {
    final RandomAccessFile file;
    long pos;  // virtual position
    FileReader(RandomAccessFile file, long pos) throws IOException { this.file = file; this.pos = pos; }
    @Override public int read(byte[] buffer, int offset, int length) throws IOException {
      if (pos < prefix.length) {
        int n = (int) Math.min(length, prefix.length - pos);
        System.arraycopy(prefix, (int) pos, buffer, offset, n);
        pos += n;
        return n;
      }
      file.seek(pos - prefix.length + fileStart);
      int n = file.read(buffer, offset, length);
      if (n < 0) return C.RESULT_END_OF_INPUT;
      pos += n;
      return n;
    }
  }

  static final class Output implements ExtractorOutput, TrackOutput {
    SeekMap seekMap;
    final List<long[]> samples = new ArrayList<>();
    FileReader reader;
    @Override public TrackOutput track(int id, int type) { return this; }
    @Override public void endTracks() {}
    @Override public void seekMap(SeekMap seekMap) { this.seekMap = seekMap; }
    @Override public void format(Format format) {}
    long sampleStart = -1;
    @Override public int sampleData(DataReader input, int length, boolean allowEndOfInput, int sampleDataPart) throws IOException {
      if (sampleStart < 0) sampleStart = ((androidx.media3.extractor.ExtractorInput) input).getPosition();
      byte[] skip = new byte[length];
      int n = input.read(skip, 0, length);
      return n;
    }
    @Override public void sampleData(ParsableByteArray data, int length, int sampleDataPart) { data.skipBytes(length); }
    @Override public void sampleMetadata(long timeUs, int flags, int size, int offset, CryptoData cryptoData) {
      samples.add(new long[] {timeUs, sampleStart});
      sampleStart = -1;
    }
  }

  public static void main(String[] args) throws Exception {
    androidx.media3.common.util.Log.setLogger(new androidx.media3.common.util.Log.Logger() {
      @Override public void d(String tag, String message, Throwable t) {}
      @Override public void i(String tag, String message, Throwable t) { System.err.println("I/" + tag + ": " + message); }
      @Override public void w(String tag, String message, Throwable t) { System.err.println("W/" + tag + ": " + message); }
      @Override public void e(String tag, String message, Throwable t) { System.err.println("E/" + tag + ": " + message); }
    });
    String src = args[0];
    if (src.startsWith("virtual:")) {  // virtual:<prefix file>|<original file>|<original tag length>
      String[] p = src.substring(8).split("[|]");
      prefix = java.nio.file.Files.readAllBytes(java.nio.file.Path.of(p[0]));
      src = p[1];
      fileStart = Long.parseLong(p[2]);
    }
    RandomAccessFile file = new RandomAccessFile(src, "r");
    long length = file.length() - fileStart + prefix.length;
    int flags = Integer.getInteger("mp3flags", 0);
    Mp3Extractor extractor = new Mp3Extractor(flags);
    Output out = new Output();
    extractor.init(out);
    out.reader = new FileReader(file, 0);
    DefaultExtractorInput input = new DefaultExtractorInput(out.reader, 0, length);
    PositionHolder holder = new PositionHolder();
    while (out.seekMap == null || out.samples.isEmpty()) {
      int r = extractor.read(input, holder);
      if (r == androidx.media3.extractor.Extractor.RESULT_SEEK) {
        out.reader = new FileReader(file, holder.position);
        input = new DefaultExtractorInput(out.reader, holder.position, length);
      } else if (r == androidx.media3.extractor.Extractor.RESULT_END_OF_INPUT) break;
    }
    System.out.println("seeker " + out.seekMap.getClass().getSimpleName() + " seekable " + out.seekMap.isSeekable() + " durationUs " + out.seekMap.getDurationUs());
    for (int i = 1; i < args.length; i++) {
      long targetUs = Math.round(Double.parseDouble(args[i]) * 1000);
      long position = out.seekMap.getSeekPoints(targetUs).first.position;
      out.samples.clear();
      out.sampleStart = -1;
      out.reader = new FileReader(file, position);
      input = new DefaultExtractorInput(out.reader, position, length);
      extractor.seek(position, targetUs);
      while (out.samples.isEmpty()) {
        int r = extractor.read(input, holder);
        if (r == androidx.media3.extractor.Extractor.RESULT_SEEK) {
          out.reader = new FileReader(file, holder.position);
          input = new DefaultExtractorInput(out.reader, holder.position, length);
        } else if (r == androidx.media3.extractor.Extractor.RESULT_END_OF_INPUT) break;
      }
      long[] first = out.samples.get(0);
      System.out.println(args[i] + " " + first[0] + " " + first[1] + " " + position);
    }
  }
}
