package android.util;
/** Minimal JVM stand-in for android.util.Pair (same public fields and factory), for running media3 off-device. */
public class Pair<F, S> {
  public final F first;
  public final S second;
  public Pair(F first, S second) { this.first = first; this.second = second; }
  public static <A, B> Pair<A, B> create(A a, B b) { return new Pair<>(a, b); }
}
