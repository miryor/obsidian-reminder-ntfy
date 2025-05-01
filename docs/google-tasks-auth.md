# Google Tasks Sync Integration

This document explains how to set up and use the Google Tasks synchronization feature within the Obsidian Reminder plugin.

## Overview

This integration allows you to synchronize your Obsidian reminders (specifically, checklist items with reminder syntax) with a designated list in your Google Tasks account. This provides a way to see and potentially manage your Obsidian reminders outside of Obsidian. Note: The Google Tasks API doesn't recognize times, only dates. A request to recognize time has been an open request for many years and Google doesn't seem to want to change this.

Currently, the synchronization is primarily **one-way** (Obsidian -> Google Tasks). However, the sync process _can_ detect if a task linked to an Obsidian reminder has been **completed or deleted** directly in Google Tasks and update the Obsidian reminder accordingly on the next sync.

## 1. Setting up Google Cloud Credentials

To use this feature, you need to authorize the plugin to access your Google Tasks. This requires creating your own OAuth 2.0 Client ID in the Google Cloud Console.

**Steps:**

1.  **Go to Google Cloud Console:** Navigate to [https://console.cloud.google.com/](https://console.cloud.google.com/). You may need to log in with your Google account.
2.  **Create/Select Project:**
    - If you don't have a project, create one using the project selector at the top.
    - If you have existing projects, select the one you want to use.
3.  **Enable Google Tasks API:**
    - In the search bar at the top, search for "Google Tasks API".
    - Select the API from the results.
    - Click the **Enable** button if it's not already enabled.
4.  **Configure OAuth Consent Screen:**
    - Navigate to "APIs & Services" -> "OAuth consent screen" using the left-hand menu.
    - Choose **External** user type (unless you have a Google Workspace account and only want internal use).
    - Fill in the required app information (App name like "Obsidian Reminder Sync", user support email, developer contact email).
    - Scopes: You don't need to add scopes here; the plugin will request them during authorization.
    - Test Users: Add your own Google account email address as a test user while the app is in "Testing" status. (You can later publish the app if needed, but Testing status is usually sufficient for personal use).
    - Save the consent screen configuration.
5.  **Create OAuth Client ID:**
    - Navigate to "APIs & Services" -> "Credentials".
    - Click **+ CREATE CREDENTIALS** at the top and select **OAuth client ID**.
    - For **Application type**, select **Universal Windows Platform (UWP)**.
    - Give it a name (e.g., "Obsidian Reminder Client").
    - Click **Create**.
6.  **Copy Client ID:** A pop-up will show your "Client ID" and "Client secret". **Copy your Client ID**. You will paste this into the plugin settings later. The Client Secret is _not_ needed for the plugin settings.
7.  **Configure Redirect URI:**
    - After closing the pop-up, find the Client ID you just created under the "OAuth 2.0 Client IDs" section and click on its name to edit it.
    - Scroll down to the **Authorized redirect URIs** section.
    - Click **+ ADD URI**.
    - Enter the following URI: `http://localhost:PORT/oauth2callback`
    - **Important:** Replace `PORT` with the port number configured in the Reminder plugin's settings (under "Google Tasks Integration"). The default port is **8080**. So, by default, you would add `http://localhost:8080/oauth2callback`.
    - Click **Save** at the bottom.

You now have the Client ID needed for the plugin settings.

## 2. Authentication Flow (PKCE & Local Server)

The plugin uses the secure **OAuth 2.0 Authorization Code flow with PKCE** (Proof Key for Code Exchange). This is the standard, recommended flow for desktop applications accessing Google APIs.

Here's how it works when you initiate authentication (either via command or automatically after enabling the setting/experiencing a refresh failure):

1.  **Local Server Start:** The plugin temporarily starts a small web server on your computer, listening on the port specified in the settings (e.g., `http://localhost:8080`).
2.  **Browser Redirect:** Your default web browser opens, directing you to Google's authentication page. The plugin sends along the Client ID and requests permission to access your Google Tasks.
3.  **Google Authorization:** You log in (if necessary) and grant the requested permission.
4.  **Redirect Back:** Google redirects your browser back to the **local** address (e.g., `http://localhost:8080/oauth2callback`) that you configured in the Cloud Console. This redirect includes a temporary authorization code.
5.  **Code Capture:** The local server running temporarily catches this redirect, extracts the authorization code from the URL, and securely sends it back to the Obsidian plugin.
6.  **Server Stop:** The local server immediately stops listening once the code is captured.
7.  **Token Exchange:** The plugin securely exchanges this authorization code (along with a secret 'code verifier' generated using PKCE) with Google's token endpoint to obtain an **access token** (for making API calls) and a **refresh token** (for getting new access tokens later without full re-authentication).
8.  **Token Storage:** These tokens are stored securely in Obsidian's local storage.

This flow ensures that your Google credentials are never directly handled or stored by the plugin, and the use of PKCE prevents authorization code interception attacks.

## 3. Synchronization Mechanism

Once authenticated, the plugin can synchronize reminders.

- **Triggering:** Sync can be triggered manually using the "Sync reminders with Google Tasks" command, or automatically during the plugin's periodic background checks (respecting a minimum 5-minute interval between automatic syncs).
- **Target List:** The plugin uses the task list name specified in the settings (default: "obsidian"). If this list doesn't exist in your Google Tasks, the plugin will attempt to create it during the first sync.
- **Process:**
  1.  Fetches the list of _active_ (non-completed) tasks from the target Google Task list.
  2.  Iterates through _all_ reminders found in your Obsidian vault.
  3.  For each Obsidian reminder, it checks for associated Google Task metadata stored within the markdown file.
  4.  It compares the Obsidian reminder's current state (title, due date, completion status) against the stored metadata and the fetched Google Task list to decide whether to:
      - **Create:** If no metadata exists, create a new task in Google Tasks.
      - **Update:** If metadata exists, the Google task is active, and the reminder has changed (checksum mismatch), update the Google task.
      - **Recreate:** If metadata exists but the task is missing from the active Google list (likely deleted or completed in Google), it fetches the specific task to confirm. If deleted (404) or unexpectedly not completed, it recreates the task in Google.
      - **Mark Done Locally:** If metadata exists, but the task is missing from the active Google list and fetching it confirms it's 'completed', it marks the reminder as done (`- [x]`) in Obsidian.
      - **Skip:** If metadata exists, the task is active, and the reminder hasn't changed (checksum match), do nothing.
- **Metadata Comment:** To link an Obsidian reminder to its corresponding Google Task, the plugin adds a special HTML comment to the end of the reminder line in your markdown file. It looks like this:
  ```html
  <!-- gtask:{\"id\":\"GOOGLE_TASK_ID\",\"checksum\":\"SOME_CHECKSUM\"} -->
  ```
  - `id`: The unique ID of the task in Google Tasks.
  - `checksum`: A value calculated based on the reminder's content (title, date/time, status) used to detect changes.
  - **WARNING:** **Do NOT manually edit or delete this comment!** Modifying it will break the link between the Obsidian reminder and the Google Task, potentially causing duplicates or sync errors.

## 4. Plugin Settings

The following settings control the Google Tasks integration (found under "Google Tasks Integration" in the Reminder plugin settings):

- **`Enable Google Tasks integration`**: (Toggle) Master switch to turn the sync feature on or off.
- **`Google Tasks List Name`**: (Text) The exact name of the Google Tasks list you want to sync with. The default is `obsidian`. The plugin will try to create this list if it doesn't exist.
- **`Google Tasks OAuth port`**: (Number) The local port number used for the authentication callback (see Section 2). Default is `8080`. Change this only if port 8080 is already used by another application on your system. If you change it, you **must** update the Authorized Redirect URI in your Google Cloud Console credentials accordingly.
- **`Google Tasks Client ID`**: (Text) Your personal OAuth 2.0 Client ID obtained from the Google Cloud Console (see Section 1). You must paste the Client ID you created here.

## 5. Available Commands

You can use the Obsidian command palette to access these Google Tasks related commands:

- **`Sync reminders with Google Tasks`**: Manually triggers the synchronization process described in Section 3.
- **`Get tasks from Google Tasks list (Log to console)`**: Fetches all tasks (including completed) from the configured Google Tasks list and prints their details to the Obsidian Developer Console. Useful for debugging.
- **`Clear Google Tasks authentication`**: Removes the stored access and refresh tokens. Use this if you encounter persistent authentication issues or want to switch Google accounts.
- **`Force Re-authenticate with Google Tasks`**: Clears existing authentication tokens and immediately starts the full OAuth authentication flow. Useful if authentication seems broken or you need to switch accounts quickly.
- **`Verify Google Tasks authentication`**: Attempts to fetch your Google Task lists to confirm the current authentication tokens are valid.
- **`Refresh Google Tasks token`**: Manually attempts to refresh the access token using the stored refresh token. Usually not needed, as refresh happens automatically.
- **`Get Google Tasks list`**: Finds the task list specified in settings, creating it if necessary, and logs its details to the console.
- **`Authenticate with Google Tasks`**: (May not be directly listed, often triggered by other commands/settings) Initiates the full OAuth authentication flow described in Section 2.

## Troubleshooting

- **Authentication Failing?**
  - Double-check that the **Redirect URI** in your Google Cloud Console credentials exactly matches `http://localhost:PORT/oauth2callback` (using the port from your plugin settings).
  - Ensure you added your email address as a **Test User** in the OAuth Consent Screen settings if your Google Cloud project is still in the "Testing" publishing status.
  - Check the Obsidian Developer Console (`Cmd+Option+I` or `Ctrl+Shift+I`) for specific error messages (like `redirect_uri_mismatch`, `invalid_client`, `invalid_grant`).
  - Try using the "Clear Google Tasks authentication" command and re-authenticating.
- **Sync Not Working?**
  - Ensure the "Enable Google Tasks integration" setting is turned on.
  - Use the "Verify Google Tasks authentication" command.
  - Check the Developer Console for errors logged during the sync process.
  - Ensure the "Google Tasks List Name" setting exactly matches the list you want to use in Google Tasks.
