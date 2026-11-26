PrintFair: A Mobile-Based Printing Request and Management
System for XU Library Printing Services

Main Features:
Document and Printing Request Management - Students can upload PDF documents, review document information and page counts, submit printing requests, and monitor request status.

Print Access and Station Management - Students can view printing station information. Administrators can manage station availability. The separate kiosk webpage accepts retrieval codes and provides access to prepared documents.

Printing Allowance and Transaction Management - The application validates the daily page allowance and records request and transaction activity. Students can view printing history, while administrators can review transaction details.


Technologies:
Apache Cordova
HTML, CSS, and JavaScript
Supabase
Android SDK and Gradle
Git and GitHub

Requirements:
Install the following tools before building the Android application:
Node.js and npm
Apache Cordova CLI
Java Development Kit (JDK) 17
Android Studio and Android SDK
Gradle compatible with the installed Cordova Android platform

Setup
Clone the repository:
```bash
   git clone https://github.com/unte-unteyassin/ITCC-41-FINAL-PROJECT.git
   cd ITCC-41-FINAL-PROJECT
   ```
Install the Cordova Android platform if it is not already installed:
```bash
   cordova platform add android
   ```
Check the Android build requirements:
```bash
   cordova requirements android
   ```
Prepare and build the application:
```bash
   cordova prepare android
   cordova build android --debug
   ```
The debug APK is normally generated at:
```text
   platforms/android/app/build/outputs/apk/debug/app-debug.apk
   ```
   
On Windows PowerShell, use `cordova.cmd` if the `cordova` command is not recognized.
Supabase Configuration
PrintFair uses a Supabase project for backend services. Review `www/backend-config.js`
The `print-documents` storage bucket is intended to remain private; access should be controlled by the application's backend policies and signed document access.
Enable/configure the required Supabase authentication, database permissions, storage policies, and realtime functionality for the project.

Running the Kiosk
The kiosk is a separate webpage within the same project. It uses the shared Supabase backend and is intended to be opened on a library computer. The kiosk page is:
```text
www/kiosk.html
```
For local interface testing, the project includes this npm script:
```bash
npm run serve
```
Then open the kiosk page at:
```text
http://localhost:8765/kiosk.html
```
The local server is for development/testing. A deployed kiosk requires an appropriate hosting environment and secure access configuration.
Tests
Run the included smoke test with:
```bash
npm test
```

Repository
https://github.com/unte-unteyassin/ITCC-41-FINAL-PROJECT

Course: ITCC 41 – Mobile Applications Development  
Institution: Xavier University – Ateneo de Cagayan  
Group Members: Gio Duldoco, Godofredo Natividad III, Yassin Unte
