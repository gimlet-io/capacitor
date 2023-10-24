const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  style: {
    postcss: {
      plugins: {
        'postcss-import': {},
        tailwindcss: {},
        autoprefixer: {},
      },
    },
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter var', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  devServer: {
    allowedHosts: ['localhost'],
  },
}
