// Keep the original release project untouched; preview builds use our testing project.
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'preview') return config;
  const projectId = 'cfd6a950-39cd-42d8-a524-a9d964470d9a';
  const preview = {
    ...config,
    name: 'Kinnred Preview',
    slug: 'kinnred-preview',
    owner: 'madtech2026',
    android: { ...config.android, package: 'app.kinnred.preview' },
    ios: { ...config.ios, bundleIdentifier: 'app.kinnred.preview' },
    extra: { ...config.extra, eas: projectId ? { projectId } : {} },
  };
  if (projectId) preview.updates = { ...config.updates, url: 'https://u.expo.dev/' + projectId };
  else delete preview.updates;
  return preview;
};
