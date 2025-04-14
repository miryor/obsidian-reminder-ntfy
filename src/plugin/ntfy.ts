import type ReminderPlugin from "main";
import type { Reminder } from "model/reminder";

/**
 * NtfyService handles sending notifications via ntfy.sh service
 */
export class NtfyService {
  constructor(private plugin: ReminderPlugin) {}

  /**
   * Sends a notification to ntfy.sh
   */
  async sendNotification(reminder: Reminder): Promise<boolean> {
    if (!this.plugin.settings.enableNtfy.value) {
      console.log("Ntfy is disabled");
      return false;
    }

    const topic = this.plugin.settings.ntfyTopic.value;
    const server = this.plugin.settings.ntfyServer.value || "https://ntfy.sh";
    const priority = this.plugin.settings.ntfyPriority.value || "default";
    const token = this.plugin.settings.ntfyToken.value;

    if (!topic) {
      console.error("Ntfy topic is not specified");
      return false;
    }

    try {
      const url = `${server}/${topic}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add token authentication if provided
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Title: reminder.title,
          Priority: priority,
        },
        body: `${reminder.title} ${reminder.time}`,
      });

      if (!response.ok) {
        console.error(
          "Failed to send ntfy notification:",
          await response.text(),
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error sending ntfy notification:", error);
      return false;
    }
  }
}
