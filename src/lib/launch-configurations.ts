import {
  emptyLaunchConfigurationPool,
  parseLaunchConfigurationPool,
  type AgentLaunchConfigurationInput,
  type LaunchConfigurationPoolV1,
} from '@exawatt/core';

export * from '@exawatt/core';

function settingsApi() {
  const settings =
    typeof window === 'undefined' ? undefined : window.electron?.settings;
  if (!settings)
    throw new Error('Launch Configuration persistence is unavailable');
  return settings;
}

export async function loadLaunchConfigurationPool(): Promise<LaunchConfigurationPoolV1> {
  if (typeof window === 'undefined' || !window.electron?.settings) {
    return emptyLaunchConfigurationPool();
  }
  const settings = await window.electron.settings.get();
  return parseLaunchConfigurationPool(settings.launchConfigurations);
}

export async function recordLaunchConfigurationSuccess(
  projectDir: string,
  target: AgentLaunchConfigurationInput | { kind: 'shell' }
): Promise<LaunchConfigurationPoolV1> {
  const settings = await settingsApi().recordLaunchConfigurationSuccess(
    projectDir,
    target
  );
  return parseLaunchConfigurationPool(settings.launchConfigurations);
}

export async function saveNamedLaunchConfiguration(
  configuration: AgentLaunchConfigurationInput,
  name: string
): Promise<LaunchConfigurationPoolV1> {
  const settings = await settingsApi().saveNamedLaunchConfiguration(
    configuration,
    name
  );
  return parseLaunchConfigurationPool(settings.launchConfigurations);
}

export async function renameLaunchConfiguration(
  id: string,
  name: string
): Promise<LaunchConfigurationPoolV1> {
  const settings = await settingsApi().renameLaunchConfiguration(id, name);
  return parseLaunchConfigurationPool(settings.launchConfigurations);
}

export async function deleteLaunchConfiguration(
  id: string
): Promise<LaunchConfigurationPoolV1> {
  const settings = await settingsApi().deleteLaunchConfiguration(id);
  return parseLaunchConfigurationPool(settings.launchConfigurations);
}

export async function setLaunchConfigurationPinned(
  projectDir: string,
  id: string,
  pinned: boolean
): Promise<LaunchConfigurationPoolV1> {
  const settings = await settingsApi().setLaunchConfigurationPinned(
    projectDir,
    id,
    pinned
  );
  return parseLaunchConfigurationPool(settings.launchConfigurations);
}
