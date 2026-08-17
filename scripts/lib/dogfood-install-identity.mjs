import path from 'node:path';

export function dogfoodInstallLayout(
  packaged,
  {
    installDir = '/Applications',
    homeDirectory,
    updateStateOverride,
  }
) {
  const productName = packaged.identity.productName;
  const userDataDirectoryName = packaged.contract.brand
    ? productName
    : packaged.identity.stateNamespace;
  return {
    target: path.join(installDir, `${productName}.app`),
    staging: path.join(installDir, `.${productName}.transaction.app`),
    statePath:
      updateStateOverride ??
      path.join(
        homeDirectory,
        'Library',
        'Application Support',
        userDataDirectoryName,
        'update-state.json'
      ),
  };
}
