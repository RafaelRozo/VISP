module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Allow styles defined after component in same file
    'no-use-before-define': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    // Allow unused vars prefixed with underscore
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
    ],
    // Allow React in scope for JSX (required pre-17 transform)
    'react/react-in-jsx-scope': 'off',
  },
};
