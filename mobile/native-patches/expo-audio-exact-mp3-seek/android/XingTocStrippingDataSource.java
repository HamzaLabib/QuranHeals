package expo.modules.audio;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Quran Heals patch (native-patches/expo-audio-exact-mp3-seek): exact seeking in VBR MP3 files, without changing them.
 *
 * media3 1.9.0's Mp3Extractor seeks a LAME VBR file through its Xing table of contents: 100 points, interpolated, so a
 * seek lands seconds away from the time it reports (measured up to 7 s on Quran recitations). With
 * Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING the extractor builds an exact time-to-byte index as it reads, but only when the
 * file's own seeker is not seekable. This DataSource serves the stream with the first frame's Xing header WITHOUT its
 * table of contents (the TOC flag cleared, the fields after the table moved up, zeros to the frame's own length): the
 * Xing seeker then keeps the exact duration (frame count) but is not seekable, so the index seeker is used. Every byte
 * after that frame is served unchanged at its own position; nothing is stored.
 *
 * Used ONLY for sources the app marks (AudioModule: header X-Quran-Heals-Mp3-Seek: index). Every other source, every
 * CBR file, is played exactly as before.
 */
public final class XingTocStrippingDataSource implements DataSource {
  /** The header a source carries to be played through this DataSource (removed before any request is made). */
  public static final String MARKER_HEADER = "X-Quran-Heals-Mp3-Seek";
  public static final String MARKER_VALUE = "index";
  /** At most this much of the start of the file is held to find the Xing frame (ID3 tag included). */
  static final int MAX_HEAD = 4 * 1024 * 1024;

  public static final class Factory implements DataSource.Factory {
    private final DataSource.Factory upstream;

    public Factory(DataSource.Factory upstream) {
      this.upstream = upstream;
    }

    @Override
    public DataSource createDataSource() {
      return new XingTocStrippingDataSource(upstream.createDataSource());
    }
  }

  private final DataSource upstream;
  @Nullable private byte[] head;
  private int headLength;
  private long position;
  private long remaining;

  public XingTocStrippingDataSource(DataSource upstream) {
    this.upstream = upstream;
  }

  @Override
  public void addTransferListener(TransferListener transferListener) {
    upstream.addTransferListener(transferListener);
  }

  @Override
  public long open(DataSpec dataSpec) throws IOException {
    head = null;
    position = dataSpec.position;
    remaining = dataSpec.length;
    long total = upstream.open(dataSpec.buildUpon().setPosition(0).setLength(C.LENGTH_UNSET).build());
    // The head (ID3 tag + first frame) is read from the file's start, whatever was asked, and rewritten in memory.
    byte[] start = new byte[10];
    int n = readFully(start, 0, 10);
    int need = Math.min(MAX_HEAD, id3Length(start, n) + 8192);
    byte[] buf = new byte[need];
    System.arraycopy(start, 0, buf, 0, n);
    n += readFully(buf, n, need - n);
    stripXingToc(buf, n);
    head = buf;
    headLength = n;
    if (position > headLength) {
      // Past the head: skip what remains up to the position (only when a read resumes just after the head).
      skip(position - headLength);
    }
    if (dataSpec.length != C.LENGTH_UNSET) return dataSpec.length;
    return total == C.LENGTH_UNSET ? C.LENGTH_UNSET : total - dataSpec.position;
  }

  @Override
  public int read(byte[] buffer, int offset, int length) throws IOException {
    if (length == 0) return 0;
    if (remaining == 0) return C.RESULT_END_OF_INPUT;
    int want = remaining == C.LENGTH_UNSET ? length : (int) Math.min(length, remaining);
    int n;
    if (head != null && position < headLength) {
      n = (int) Math.min(want, headLength - position);
      System.arraycopy(head, (int) position, buffer, offset, n);
    } else {
      n = upstream.read(buffer, offset, want);
      if (n == C.RESULT_END_OF_INPUT) return n;
    }
    position += n;
    if (remaining != C.LENGTH_UNSET) remaining -= n;
    return n;
  }

  @Nullable
  @Override
  public Uri getUri() {
    return upstream.getUri();
  }

  @Override
  public Map<String, List<String>> getResponseHeaders() {
    return upstream.getResponseHeaders();
  }

  @Override
  public void close() throws IOException {
    head = null;
    upstream.close();
  }

  private int readFully(byte[] b, int off, int len) throws IOException {
    int done = 0;
    while (done < len) {
      int r = upstream.read(b, off + done, len - done);
      if (r == C.RESULT_END_OF_INPUT) break;
      done += r;
    }
    return done;
  }

  private void skip(long count) throws IOException {
    byte[] scratch = new byte[8192];
    while (count > 0) {
      int r = upstream.read(scratch, 0, (int) Math.min(scratch.length, count));
      if (r == C.RESULT_END_OF_INPUT) return;
      count -= r;
    }
  }

  /** Bytes of the ID3v2 tag at the file's start (header, body, footer), or 0. */
  public static int id3Length(byte[] b, int n) {
    if (n < 10 || b[0] != 'I' || b[1] != 'D' || b[2] != '3') return 0;
    int size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    return 10 + size + ((b[5] & 0x10) != 0 ? 10 : 0);
  }

  /** The size of the MPEG-1/2/2.5 Layer III frame whose header is at b[i], or 0. */
  static int frameSize(byte[] b, int i, int n) {
    if (i + 4 > n || (b[i] & 0xff) != 0xff || (b[i + 1] & 0xe0) != 0xe0) return 0;
    int ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = (b[i + 2] >> 4) & 15, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver == 1 || layer != 1 || bri == 0 || bri == 15 || sri == 3) return 0;
    int[] v1 = {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320};
    int[] v2 = {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160};
    int[][] rates = {{11025, 12000, 8000}, {0, 0, 0}, {22050, 24000, 16000}, {44100, 48000, 32000}};
    int kbps = ver == 3 ? v1[bri] : v2[bri];
    return (ver == 3 ? 144 : 72) * kbps * 1000 / rates[ver][sri] + pad;
  }

  /**
   * Removes the table of contents from the Xing header of the first audio frame in b[0..n), in place, keeping the
   * frame's length. Returns whether it did (false: no such header, no table, or the frame is not wholly in b).
   */
  static boolean stripXingToc(byte[] b, int n) {
    int i = id3Length(b, n);
    int limit = Math.min(n - 4, i + 4096);
    while (i < limit && frameSize(b, i, n) == 0) i++;
    int size = frameSize(b, i, n);
    if (size == 0 || i + size > n) return false;
    for (int k = i + 4; k + 8 <= i + size; k++) {
      if (b[k] != 'X' || b[k + 1] != 'i' || b[k + 2] != 'n' || b[k + 3] != 'g') continue;
      int flags = ((b[k + 4] & 0xff) << 24) | ((b[k + 5] & 0xff) << 16) | ((b[k + 6] & 0xff) << 8) | (b[k + 7] & 0xff);
      if ((flags & 4) == 0) return false;
      int toc = k + 8 + ((flags & 1) != 0 ? 4 : 0) + ((flags & 2) != 0 ? 4 : 0);
      if (toc + 100 > i + size) return false;
      int end = i + size;
      System.arraycopy(b, toc + 100, b, toc, end - toc - 100);
      for (int z = end - 100; z < end; z++) b[z] = 0;
      b[k + 7] = (byte) (flags & ~4);
      return true;
    }
    return false;
  }
}
