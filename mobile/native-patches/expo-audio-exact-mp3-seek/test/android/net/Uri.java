package android.net;

/** JVM test stand-in for android.net.Uri (android.jar holds only stubs that throw): enough for FileDataSource. */
public class Uri {
  private final String path;
  private Uri(String path) { this.path = path; }
  public static Uri fromFile(java.io.File f) { return new Uri(f.getAbsolutePath()); }
  public static Uri parse(String s) { return new Uri(s); }
  public String getPath() { return path; }
  public String getScheme() { return "file"; }
  public String getQuery() { return null; }
  public String getFragment() { return null; }
  public String getLastPathSegment() { return new java.io.File(path).getName(); }
  @Override public String toString() { return "file://" + path; }
}
