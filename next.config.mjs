/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['pdfjs-dist'],
  webpack: (config, { webpack }) => {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    config.resolve.fallback = { fs: false, path: false, crypto: false, module: false, canvas: false };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.module.unknownContextCritical = false;
    // libredwg-web WASM glue does `import("node:module")`; webpack treats `node:` as an unknown URI.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '');
      }),
      new webpack.IgnorePlugin({ resourceRegExp: /^node:/ }),
    );
    const { NormalModule } = webpack;
    if (NormalModule?.getCompilationHooks) {
      config.plugins.push({
        apply(compiler) {
          compiler.hooks.compilation.tap('NodeSchemeStub', (compilation) => {
            NormalModule.getCompilationHooks(compilation)
              .readResourceForScheme.for('node')
              .tapAsync('NodeSchemeStub', (_resource, _mod, callback) => {
                callback(null, 'module.exports = {};');
              });
          });
        },
      });
    }
    return config;
  },
};

export default nextConfig;
