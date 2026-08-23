function readPackage(pkg) {
  if (pkg.dependencies && pkg.dependencies.esbuild) {
    pkg.dependencies.esbuild = "^0.25.0";
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
