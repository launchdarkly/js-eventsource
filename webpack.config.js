const webpack = require('webpack');

module.exports = {
  node: {
    global: true
  },
  resolve: {
    fallback: {
      url: require.resolve('url/'),
      events: require.resolve('events'),
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      util: require.resolve('util'),
      buffer: require.resolve('buffer'),
      process: require.resolve('process/browser')
    }
  },
  output: {
    filename: "eventsource-polyfill.js"
  },
  plugins: [new webpack.DefinePlugin({
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    'process.env.NODE_DEBUG': JSON.stringify(process.env.DEBUG),
  })],
  optimization: {
    minimize: false,
  }
}