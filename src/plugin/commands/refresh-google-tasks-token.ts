import type ReminderPlugin from "main";

/**
 * Command to manually refresh the Google Tasks access token
 * This is useful when the token might be expired but the auto-refresh hasn't triggered
 */
export function refreshGoogleTasksToken(
  checking: boolean,
  plugin: ReminderPlugin,
): boolean {
  // If we're just checking, return true if Google Tasks integration is enabled
  if (checking) {
    return plugin.settings.enableGoogleTasks.value;
  }

  // Actually refresh the token
  plugin.refreshGoogleTasksToken();
  return true;
}
