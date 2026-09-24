import java.util.zip.ZipFile

plugins { kotlin("jvm") version "2.1.20" }
dependencies {
  compileOnly("org.robolectric:android-all:15-robolectric-12650502")
  testImplementation("org.robolectric:android-all:15-robolectric-12650502")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.robolectric:robolectric:4.14.1")
}
kotlin { jvmToolchain(21) }
val aarDirectory = layout.buildDirectory.dir("aar-jars")
val unpackAndroidAars = tasks.register("unpackAndroidAars") {
  inputs.files(configurations.testRuntimeClasspath)
  outputs.dir(aarDirectory)
  doLast {
    val target = aarDirectory.get().asFile.apply { mkdirs() }
    configurations.testRuntimeClasspath.get().filter { it.extension == "aar" }.forEach { archive ->
      ZipFile(archive).use { zip ->
        zip.getEntry("classes.jar")?.let { entry -> zip.getInputStream(entry).use { input -> target.resolve(archive.nameWithoutExtension + ".jar").outputStream().use { input.copyTo(it) } } }
      }
    }
  }
}
// The runner copies the current production Kotlin into this isolated project.
// This compiles the store + overlay against real Android APIs, without claiming
// an Expo/RN APK build or real-device input-dispatch verification.
tasks.test {
  dependsOn(unpackAndroidAars)
  classpath += files(aarDirectory.map { fileTree(it) { include("*.jar") } })
  systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
  for (key in listOf("http.proxyHost", "http.proxyPort", "https.proxyHost", "https.proxyPort")) {
    System.getProperty(key)?.let { systemProperty(key, it) }
  }
  testLogging { events("passed", "failed", "skipped"); showStandardStreams = true }
  maxHeapSize = "2g"
}
