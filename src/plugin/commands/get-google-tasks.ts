import type ReminderPlugin from "main";

/**
 * Command to get and print tasks from the configured Google Tasks list
 * This retrieves all tasks from the list specified in plugin settings
 * and prints them to the developer console
 */
export function getGoogleTasks(
  checking: boolean,
  plugin: ReminderPlugin,
): boolean {
  // If we're just checking, return true if Google Tasks integration is enabled
  if (checking) {
    return plugin.settings.enableGoogleTasks.value;
  }

  // Get and print the tasks
  plugin.getGoogleTasks();
  return true;
}
