import androidx.media3.common.C;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.FileDataSource;
import androidx.media3.extractor.DefaultExtractorInput;
import androidx.media3.extractor.Extractor;
import androidx.media3.extractor.ExtractorOutput;
import androidx.media3.extractor.PositionHolder;
import androidx.media3.extractor.SeekMap;
import androidx.media3.extractor.TrackOutput;
import androidx.media3.extractor.mp3.Mp3Extractor;
import androidx.media3.common.DataReader;
import androidx.media3.common.Format;
import androidx.media3.common.util.ParsableByteArray;
import android.net.Uri;
import expo.modules.audio.XingTocStrippingDataSource;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * JVM test of XingTocStrippingDataSource with the real media3 1.9.0 classes (Uri is a test stub).
 * usage: java StripTest <original.mp3> <expected rewritten copy.mp3> <targetMs> ...
 * 1. the whole stream served through it equals the expected copy byte for byte;
 * 2. opened at positions inside and after the head it serves the same bytes as the copy from there;
 * 3. the real Mp3Extractor (FLAG_ENABLE_INDEX_SEEKING) through it: seeker kind, duration, and for each target the
 *    first kept sample after a seek (label us, frame byte), as SeekProbeForward prints them.
 */
public final class StripTest {
  static XingTocStrippingDataSource open(File f, long pos) throws Exception {
    XingTocStrippingDataSource ds = new XingTocStrippingDataSource(new FileDataSource());
    ds.open(new DataSpec.Builder().setUri(Uri.fromFile(f)).setPosition(pos).build());
    return ds;
  }

  static byte[] readAll(XingTocStrippingDataSource ds, int max) throws Exception {
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    byte[] buf = new byte[7919];  // an odd size: reads cross the head boundary at arbitrary points
    while (out.size() < max) {
      int r = ds.read(buf, 0, Math.min(buf.length, max - out.size()));
      if (r == C.RESULT_END_OF_INPUT) break;
      out.write(buf, 0, r);
    }
    return out.toByteArray();
  }

  static final class Out implements ExtractorOutput, TrackOutput {
    SeekMap seekMap;
    final List<long[]> samples = new ArrayList<>();
    long sampleStart = -1;
    @Override public TrackOutput track(int id, int type) { return this; }
    @Override public void endTracks() {}
    @Override public void seekMap(SeekMap s) { seekMap = s; }
    @Override public void format(Format format) {}
    @Override public int sampleData(DataReader input, int length, boolean allowEnd, int part) throws java.io.IOException {
      if (sampleStart < 0) sampleStart = ((androidx.media3.extractor.ExtractorInput) input).getPosition();
      return input.read(new byte[length], 0, length);
    }
    @Override public void sampleData(ParsableByteArray data, int length, int part) { data.skipBytes(length); }
    @Override public void sampleMetadata(long timeUs, int flags, int size, int offset, CryptoData c) { samples.add(new long[] {timeUs, sampleStart}); sampleStart = -1; }
  }

  public static void main(String[] a) throws Exception {
    // media3's Log calls android.util.Log, a throwing stub on the JVM.
    androidx.media3.common.util.Log.setLogger(new androidx.media3.common.util.Log.Logger() {
      @Override public void d(String tag, String message, Throwable t) {}
      @Override public void i(String tag, String message, Throwable t) {}
      @Override public void w(String tag, String message, Throwable t) { System.err.println("W/" + tag + ": " + message); }
      @Override public void e(String tag, String message, Throwable t) { System.err.println("E/" + tag + ": " + message); }
    });
    File orig = new File(a[0]);
    byte[] expected = Files.readAllBytes(new File(a[1]).toPath());
    byte[] all = readAll(open(orig, 0), Integer.MAX_VALUE);
    System.out.println("whole stream equals the copy: " + Arrays.equals(all, expected) + " (" + all.length + " bytes)");
    int head = XingTocStrippingDataSource.id3Length(expected, expected.length) + 8192;
    long[] positions = {1, 5, 9, 10, 300, 512, 700, head - 1, head, head + 1, head + 5000, expected.length / 2, expected.length - 10};
    boolean ok = true;
    for (long p : positions) {
      byte[] got = readAll(open(orig, p), 20000);
      byte[] want = Arrays.copyOfRange(expected, (int) p, (int) Math.min(expected.length, p + 20000));
      if (!Arrays.equals(got, want)) { ok = false; System.out.println("MISMATCH at open position " + p); }
    }
    System.out.println("opens at " + positions.length + " positions serve the copy's bytes: " + ok);

    Mp3Extractor ex = new Mp3Extractor(Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING);
    Out out = new Out();
    ex.init(out);
    long length = orig.length();
    XingTocStrippingDataSource ds = open(orig, 0);
    DefaultExtractorInput in = new DefaultExtractorInput(ds, 0, length);
    PositionHolder h = new PositionHolder();
    while (out.seekMap == null || out.samples.isEmpty()) {
      int r = ex.read(in, h);
      if (r == Extractor.RESULT_SEEK) { ds.close(); ds = open(orig, h.position); in = new DefaultExtractorInput(ds, h.position, length); }
      else if (r == Extractor.RESULT_END_OF_INPUT) break;
    }
    System.out.println("seeker " + out.seekMap.getClass().getSimpleName() + " seekable " + out.seekMap.isSeekable() + " durationUs " + out.seekMap.getDurationUs());
    for (int i = 2; i < a.length; i++) {
      long t = Math.round(Double.parseDouble(a[i]) * 1000);
      long pos = out.seekMap.getSeekPoints(t).first.position;
      out.samples.clear();
      out.sampleStart = -1;
      ds.close();
      ds = open(orig, pos);
      in = new DefaultExtractorInput(ds, pos, length);
      ex.seek(pos, t);
      while (out.samples.isEmpty() || out.samples.get(out.samples.size() - 1)[0] < t) {
        int r = ex.read(in, h);
        if (r == Extractor.RESULT_SEEK) { ds.close(); ds = open(orig, h.position); in = new DefaultExtractorInput(ds, h.position, length); }
        else if (r == Extractor.RESULT_END_OF_INPUT) break;
      }
      long[] s = out.samples.get(out.samples.size() - 1);
      System.out.println(a[i] + " " + s[0] + " " + s[1] + " " + pos + " " + (s[1] - pos));
    }
  }
}
