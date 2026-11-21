import fs from "node:fs";
import path from "node:path";

const gradlePath = path.resolve(
  "apps/client/src-tauri/gen/android/app/build.gradle.kts"
);

if (!fs.existsSync(gradlePath)) {
  console.error(`Gradle build file not found at ${gradlePath}`);
  process.exit(1);
}

let content = fs.readFileSync(gradlePath, "utf8");

if (!content.includes("java.io.FileInputStream")) {
  content = `import java.io.FileInputStream\n` + content;
}

if (!content.includes('create("release")')) {
  const signingBlock = `
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
`;
  content = content.replace("buildTypes {", `${signingBlock}\n    buildTypes {`);
  content = content.replace(
    'getByName("release") {',
    'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")'
  );
  fs.writeFileSync(gradlePath, content, "utf8");
  console.log("Configured release signingConfig in build.gradle.kts");
} else {
  console.log("signingConfigs release already present");
}
