# Contributing

## Getting Started

```bash
git clone https://github.com/your-org/epistemic-swarm.git
cd epistemic-swarm
npm install
npm run build
npm test
```

## Development Workflow

1. Create a branch from `main`
2. Make changes
3. Run tests: `npm test`
4. Run the adversarial demo: `cd packages/demo && npm run adversarial`
5. Submit PR

## Code Style

- TypeScript strict mode
- ESM modules (`.js` extensions in imports)
- Functional where practical, classes for stateful components
- Document public APIs with JSDoc

## Testing

Tests are in `packages/core/test/`. Run with:

```bash
npm test
```

For a specific test:

```bash
npm test -- --grep "Sybil"
```

## Adding a New Transport

1. Create `packages/core/src/transports/your-transport.ts`
2. Implement the `Transport` interface
3. Export from `packages/core/src/transports/index.ts`
4. Add tests

## Reporting Security Issues

For security vulnerabilities, please email security@your-org.com rather than opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under MIT.
