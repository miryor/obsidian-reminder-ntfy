import { Buffer } from "buffer";
import type ReminderPlugin from "main";
// import type { Reminder } from "model/reminder";

/**
 * GoogleTasksService handles integration with Google Tasks API
 * using OAuth 2.0 with PKCE for a secure authentication flow.
 */
export class GoogleTasksService {
  private clientId: string = "";
  private redirectUri: string = "";
  private tokenData: TokenData | null = null;
  private authServer: GoogleAuthServer | null = null;
  private codeVerifier: string = "";
  private authInProgress: boolean = false;

  constructor(private plugin: ReminderPlugin) {
    this.clientId =
      "332129866391-i3fkaf0h3pb0c345mgclbaorf1pbhs9c.apps.googleusercontent.com";
    this.updateRedirectUri();
  }

  /**
   * Update the redirect URI based on the configured port
   */
  private updateRedirectUri(): void {
    const port = this.plugin.settings.googleTasksOAuthPort.value;
    this.redirectUri = `http://localhost:${port}/oauth2callback`;
  }

  /**
   * Initialize the Google Tasks service
   */
  public async initialize(): Promise<void> {
    // Load stored token data if it exists
    this.loadTokenData();

    // If we have a stored token, check if it's valid
    if (this.tokenData) {
      if (this.isTokenExpired()) {
        try {
          await this.refreshToken();
        } catch (error) {
          console.error("Error refreshing token:", error);
          this.tokenData = null;
        }
      }
    }
  }

  /**
   * Check if the user is currently authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.tokenData && !this.isTokenExpired();
  }

  /**
   * Start the OAuth authorization process
   */
  public async authorize(): Promise<void> {
    if (this.authInProgress) {
      console.log("Authorization already in progress");
      return;
    }

    try {
      this.authInProgress = true;

      // Update redirect URI in case the port has been changed in settings
      this.updateRedirectUri();

      // Store the current redirect URI for this auth session
      const currentRedirectUri = this.redirectUri;
      localStorage.setItem("google_tasks_redirect_uri", currentRedirectUri);

      // Generate code verifier and challenge
      this.codeVerifier = this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(this.codeVerifier);

      // Start the local server to handle the redirect
      const port = this.plugin.settings.googleTasksOAuthPort.value;
      this.authServer = new GoogleAuthServer(port);
      await this.authServer.start();

      // Store the code verifier for the callback
      localStorage.setItem("google_tasks_code_verifier", this.codeVerifier);

      // Construct authorization URL
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.append("client_id", this.clientId);
      authUrl.searchParams.append("redirect_uri", currentRedirectUri);
      authUrl.searchParams.append("response_type", "code");
      authUrl.searchParams.append(
        "scope",
        "https://www.googleapis.com/auth/tasks",
      );
      authUrl.searchParams.append("code_challenge", codeChallenge);
      authUrl.searchParams.append("code_challenge_method", "S256");
      authUrl.searchParams.append("access_type", "offline");
      authUrl.searchParams.append("prompt", "consent");

      // Open the browser for user authentication
      window.open(authUrl.toString(), "_blank");

      // Wait for the authentication code from the server
      const authCode = await this.authServer.waitForAuthCode();

      // Exchange auth code for tokens
      await this.exchangeCodeForTokens(authCode);

      // Close the server when we're done
      await this.authServer.stop();
      this.authServer = null;
      this.authInProgress = false;
    } catch (error) {
      console.error("Authorization error:", error);
      if (this.authServer) {
        await this.authServer.stop();
        this.authServer = null;
      }
      this.authInProgress = false;
      throw error;
    }
  }

  /**
   * Exchange the authorization code for access and refresh tokens
   */
  private async exchangeCodeForTokens(authCode: string): Promise<void> {
    try {
      const codeVerifier = localStorage.getItem("google_tasks_code_verifier");
      if (!codeVerifier) {
        throw new Error("Code verifier not found");
      }

      // Use the same redirect URI that was used in the authorization request
      const savedRedirectUri = localStorage.getItem(
        "google_tasks_redirect_uri",
      );
      if (!savedRedirectUri) {
        throw new Error("Redirect URI not found");
      }

      const tokenEndpoint = "https://oauth2.googleapis.com/token";
      const params = new URLSearchParams();
      params.append("client_id", this.clientId);
      params.append("code", authCode);
      params.append("code_verifier", codeVerifier);
      params.append("grant_type", "authorization_code");
      params.append("redirect_uri", savedRedirectUri);

      console.log("Token exchange parameters:", {
        clientId: this.clientId,
        redirectUri: savedRedirectUri,
        // Sensitive fields omitted for logging
      });

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      if (!response.ok) {
        let errorMessage = `Token request failed: HTTP ${response.status} ${response.statusText}`;

        try {
          const errorData = await response.json();
          console.error(
            "Token request failed with status:",
            response.status,
            response.statusText,
          );
          console.error("Error details:", errorData);

          // Log additional information that might help troubleshoot
          console.error("Request details:", {
            endpoint: tokenEndpoint,
            redirectUri: savedRedirectUri,
            codeVerifierLength: codeVerifier.length,
            authCodeLength: authCode.length,
          });

          errorMessage = `Token request failed: ${errorData.error || "unknown error"}`;
        } catch (parseError) {
          // Handle case where response isn't valid JSON
          const responseText = await response.clone().text();
          console.error(
            "Token request failed with status:",
            response.status,
            response.statusText,
          );
          console.error(
            "Unable to parse error response as JSON. Raw response:",
            responseText,
          );
          console.error("Parse error:", parseError);
        }

        throw new Error(errorMessage);
      }

      const tokenData = await response.json();
      this.tokenData = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + tokenData.expires_in * 1000,
      };

      // Save the token data
      this.saveTokenData();

      // Clear the temporary storage items
      localStorage.removeItem("google_tasks_code_verifier");
      localStorage.removeItem("google_tasks_redirect_uri");
    } catch (error) {
      console.error("Error exchanging code for tokens:", error);
      throw error;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshToken(): Promise<void> {
    if (!this.tokenData?.refresh_token) {
      throw new Error("No refresh token available");
    }

    try {
      const tokenEndpoint = "https://oauth2.googleapis.com/token";

      console.log("Refreshing access token...");

      // Get stored code verifier if available or generate a new one
      let codeVerifier = localStorage.getItem("google_tasks_code_verifier");
      if (!codeVerifier) {
        // Create a new code verifier if none exists
        codeVerifier = this.generateCodeVerifier();
        localStorage.setItem("google_tasks_code_verifier", codeVerifier);
      }

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          refresh_token: this.tokenData.refresh_token,
          grant_type: "refresh_token",
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        let errorMessage = `Token refresh failed: HTTP ${response.status} ${response.statusText}`;

        try {
          const errorData = await response.json();
          console.error(
            "Token refresh failed with status:",
            response.status,
            response.statusText,
          );
          console.error("Error details:", errorData);
          errorMessage = `Token refresh failed: ${errorData.error || "unknown error"}`;
        } catch (parseError) {
          // Handle case where response isn't valid JSON
          const responseText = await response.clone().text();
          console.error(
            "Token refresh failed with status:",
            response.status,
            response.statusText,
          );
          console.error(
            "Unable to parse error response as JSON. Raw response:",
            responseText,
          );
          console.error("Parse error:", parseError);
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      console.log("Token refresh successful");

      this.tokenData = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || this.tokenData.refresh_token, // Keep existing refresh token if new one isn't provided
        expires_at: Date.now() + data.expires_in * 1000,
      };

      // Save the updated token data
      this.saveTokenData();
    } catch (error) {
      console.error("Error refreshing token:", error);
      throw error;
    }
  }

  /**
   * Sync reminders with Google Tasks
   * Commented out for later implementation as a separate task
   */
  public async syncReminders(/*reminders: Reminder[]*/): Promise<void> {
    /* 
    if (!this.isAuthenticated()) {
      throw new Error("Not authenticated with Google Tasks");
    }

    try {
      // Get existing task lists
      const taskLists = await this.getTaskLists();

      // Find or create a task list for Obsidian reminders
      let obsidianTaskList = taskLists.find(
        (list) => list.title === "Obsidian Reminders",
      );
      if (!obsidianTaskList) {
        obsidianTaskList = await this.createTaskList("Obsidian Reminders");
      }

      // For each reminder, create or update a task
      for (const reminder of reminders) {
        await this.createOrUpdateTask(obsidianTaskList.id, reminder);
      }
    } catch (error) {
      console.error("Error syncing reminders with Google Tasks:", error);
      throw error;
    }
    */
    console.log(
      "Task syncing is disabled for now and will be implemented later",
    );
    return Promise.resolve();
  }

  /**
   * Get all task lists from Google Tasks
   */
  public async getTaskLists(): Promise<{ id: string; title: string }[]> {
    if (!this.isAuthenticated()) {
      throw new Error("Not authenticated with Google Tasks");
    }

    try {
      const response = await fetch(
        "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
        {
          headers: {
            Authorization: `Bearer ${this.tokenData?.access_token}`,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to get task lists:", errorText);
        throw new Error(
          `Failed to get task lists: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log("Google Tasks lists retrieved:", data);

      return (
        data.items?.map((item: any) => ({
          id: item.id,
          title: item.title,
        })) || []
      );
    } catch (error) {
      console.error("Error getting task lists:", error);
      throw error;
    }
  }

  /**
   * Get a specific task list by name
   */
  public async getTaskListByName(
    name: string,
  ): Promise<{ id: string; title: string } | null> {
    try {
      const taskLists = await this.getTaskLists();
      const taskList = taskLists.find((list) => list.title === name);
      return taskList || null;
    } catch (error) {
      console.error(`Error getting task list '${name}':`, error);
      throw error;
    }
  }

  /**
   * Verify authentication by fetching task lists
   */
  public async verifyAuthentication(): Promise<boolean> {
    try {
      const taskLists = await this.getTaskLists();
      console.log("Authentication verified. Task lists:", taskLists);
      return true;
    } catch (error) {
      console.error("Authentication verification failed:", error);
      return false;
    }
  }

  /**
   * Create a new task list
   */
  public async createTaskList(
    title: string,
  ): Promise<{ id: string; title: string }> {
    if (!this.isAuthenticated()) {
      throw new Error("Not authenticated with Google Tasks");
    }

    try {
      const response = await fetch(
        "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.tokenData?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to create task list "${title}":`, errorText);
        throw new Error(
          `Failed to create task list: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log(`Created Google Tasks list "${title}":`, data);
      return {
        id: data.id,
        title: data.title,
      };
    } catch (error) {
      console.error(`Error creating task list "${title}":`, error);
      throw error;
    }
  }

  /**
   * Create or update a task
   * Commented out for later implementation as a separate task
   */
  private async createOrUpdateTask() /*taskListId: string,
    reminder: Reminder,*/
  : Promise<void> {
    /*
    if (!this.isAuthenticated()) {
      throw new Error("Not authenticated with Google Tasks");
    }

    try {
      // Format the due date if present
      let due = null;
      if (reminder.date) {
        const date = new Date(reminder.date);
        due = date.toISOString();
      }

      // Create the task
      const response = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.tokenData?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: reminder.title,
            notes: reminder.filePath || "",
            due: due,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to create task");
      }
    } catch (error) {
      console.error("Error creating or updating task:", error);
      throw error;
    }
    */
    return Promise.resolve();
  }

  /**
   * Check if the current token is expired
   */
  private isTokenExpired(): boolean {
    if (!this.tokenData?.expires_at) {
      return true;
    }
    // Check if the token is expired with a 5-minute buffer
    return this.tokenData.expires_at <= Date.now() + 300000;
  }

  /**
   * Save token data to storage
   */
  private saveTokenData(): void {
    if (this.tokenData) {
      localStorage.setItem(
        "google_tasks_token_data",
        JSON.stringify(this.tokenData),
      );
    }
  }

  /**
   * Load token data from storage
   */
  private loadTokenData(): void {
    const storedData = localStorage.getItem("google_tasks_token_data");
    if (storedData) {
      try {
        this.tokenData = JSON.parse(storedData);
      } catch (error) {
        console.error("Error parsing stored token data:", error);
        this.tokenData = null;
      }
    }
  }

  /**
   * Generate a code verifier for PKCE
   */
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  /**
   * Generate a code challenge from the code verifier
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await window.crypto.subtle.digest("SHA-256", data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  /**
   * Base64 URL encode a buffer
   */
  private base64UrlEncode(buffer: Uint8Array): string {
    return Buffer.from(buffer)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Clear token data to force reauthentication
   */
  public clearTokenData(): void {
    this.tokenData = null;
    localStorage.removeItem("google_tasks_token_data");
    localStorage.removeItem("google_tasks_code_verifier");
    localStorage.removeItem("google_tasks_redirect_uri");
    console.log("Google Tasks authentication data cleared");
  }

  /**
   * Get a specific task list by ID
   */
  public async getTaskList(taskListId: string): Promise<any> {
    if (!this.isAuthenticated()) {
      throw new Error("Not authenticated with Google Tasks");
    }

    try {
      const response = await fetch(
        `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${taskListId}`,
        {
          headers: {
            Authorization: `Bearer ${this.tokenData?.access_token}`,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Failed to get task list with ID ${taskListId}:`,
          errorText,
        );
        throw new Error(
          `Failed to get task list: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log(`Google Tasks list with ID ${taskListId} retrieved:`, data);
      return data;
    } catch (error) {
      console.error(`Error getting task list with ID ${taskListId}:`, error);
      throw error;
    }
  }
}

/**
 * Auth server to handle the OAuth redirect by creating a real local HTTP server
 * This is possible in Obsidian when restricted mode is disabled
 * The server is only started during the authentication process and stopped afterward
 */
class GoogleAuthServer {
  private server: any = null;
  private authCodePromise: Promise<string> | null = null;
  private authCodeResolve: ((code: string) => void) | null = null;
  private authCodeReject: ((error: Error) => void) | null = null;
  private path: string = "/oauth2callback";

  constructor(private port: number = 8080) {}

  /**
   * Start a local HTTP server to handle the OAuth callback
   * This server is temporary and will be stopped after authentication
   */
  public async start(): Promise<void> {
    // Create a promise that will resolve when an auth code is received
    this.authCodePromise = new Promise((resolve, reject) => {
      this.authCodeResolve = resolve;
      this.authCodeReject = reject;
    });

    try {
      // Import Node.js modules
      // These modules are available in Obsidian when restricted mode is disabled
      const http = require("http");
      const url = require("url");

      // Create HTTP server
      this.server = http.createServer((req: any, res: any) => {
        const urlParts = url.parse(req.url, true);

        // Check if this is the OAuth callback
        if (urlParts.pathname === this.path) {
          const code = urlParts.query.code;

          if (code) {
            // Send a success page to the browser
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Authentication Successful</title>
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                      line-height: 1.6;
                      color: #333;
                      max-width: 500px;
                      margin: 0 auto;
                      padding: 2rem;
                      text-align: center;
                    }
                    .success-icon {
                      font-size: 3rem;
                      color: #4caf50;
                      margin-bottom: 1rem;
                    }
                    h1 {
                      color: #333;
                      margin-bottom: 1rem;
                    }
                    p {
                      margin-bottom: 1.5rem;
                    }
                  </style>
                </head>
                <body>
                  <div class="success-icon">✓</div>
                  <h1>Authentication Successful</h1>
                  <p>You have successfully authenticated with Google Tasks.</p>
                  <p>You can close this window and return to Obsidian.</p>
                </body>
              </html>
            `);

            // Resolve the promise with the code
            if (this.authCodeResolve) {
              this.authCodeResolve(code);

              // Schedule server shutdown after a short delay
              // This ensures the success page has time to be displayed
              setTimeout(() => {
                this.stop().catch((e) =>
                  console.error("Error stopping server:", e),
                );
              }, 2000);
            }
          } else {
            // Handle error case
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Authentication Failed</title>
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                      line-height: 1.6;
                      color: #333;
                      max-width: 500px;
                      margin: 0 auto;
                      padding: 2rem;
                      text-align: center;
                    }
                    .error-icon {
                      font-size: 3rem;
                      color: #f44336;
                      margin-bottom: 1rem;
                    }
                    h1 {
                      color: #333;
                      margin-bottom: 1rem;
                    }
                    p {
                      margin-bottom: 1.5rem;
                    }
                  </style>
                </head>
                <body>
                  <div class="error-icon">✗</div>
                  <h1>Authentication Failed</h1>
                  <p>No authorization code was received from Google.</p>
                  <p>Please try again or check the plugin settings in Obsidian.</p>
                </body>
              </html>
            `);

            if (this.authCodeReject) {
              this.authCodeReject(
                new Error("No code parameter in callback URL"),
              );
            }
          }
        } else {
          // Handle other paths
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
        }
      });

      // Start listening on the specified port
      this.server.listen(this.port, "127.0.0.1");

      console.log(
        `Auth server listening on http://localhost:${this.port}${this.path}`,
      );
    } catch (error) {
      console.error("Error starting auth server:", error);
      throw error;
    }
  }

  /**
   * Wait for an auth code to be received
   */
  public async waitForAuthCode(): Promise<string> {
    if (!this.authCodePromise) {
      throw new Error("Server not started");
    }
    return this.authCodePromise;
  }

  /**
   * Stop the server - only called when authentication is complete or fails
   */
  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server.close(() => {
          this.server = null;
          console.log(`Auth server on port ${this.port} stopped`);
          resolve();
        });
      });
    }

    if (this.authCodeReject) {
      this.authCodeReject(new Error("Server stopped"));
      this.authCodeReject = null;
    }
  }
}

/**
 * Token data type
 */
interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
