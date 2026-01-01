/**
 * Epistemic Swarm Tests
 * =====================
 * 
 * Comprehensive tests covering all major scenarios.
 */

import {
  SwarmNode,
  MemoryBus,
  MemoryTransport,
  createMemorySwarm,
  generateIdentity,
  TState,
  DriftReason,
} from '../src/index.js';

describe('Signal Signing and Verification', () => {
  it('should generate valid identity', async () => {
    const { publicKeyHex, privateKeyHex } = await generateIdentity();
    expect(publicKeyHex).toHaveLength(64);
    expect(privateKeyHex).toHaveLength(64);
  });
});

describe('Memory Transport', () => {
  it('should broadcast messages between nodes', () => {
    const { transports } = createMemorySwarm(3);
    const received: string[] = [];

    transports[1].onMessage((msg) => {
      received.push(`node1:${msg.type}`);
    });
    transports[2].onMessage((msg) => {
      received.push(`node2:${msg.type}`);
    });

    transports[0].broadcast({
      type: 'HELLO',
      from: transports[0].id,
      ts: Date.now(),
    });

    expect(received).toContain('node1:HELLO');
    expect(received).toContain('node2:HELLO');
  });
});

describe('T-State Management', () => {
  it('should degrade T-state based on staleness', async () => {
    const { transports } = createMemorySwarm(2);
    const [identity] = await Promise.all([generateIdentity()]);
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    
    expect(node.tState.state).toBe(TState.T0);
    
    // Force degradation
    node.forceTState(TState.T2);
    expect(node.tState.state).toBe(TState.T2);
    
    // Should not allow new authority in T2
    expect(node.tState.canGrantNewAuthority()).toBe(false);
  });

  it('should shrink authority windows on degradation', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex, {
      baseAuthorityDurationMs: 60000,
    });
    node.start();
    
    // Request and grant authority
    const requestId = node.requestAuthority('test-scope', 'testing');
    expect(requestId).not.toBeNull();
    
    const window = node.grantAuthority(requestId!);
    expect(window).not.toBeNull();
    
    const initialRemaining = node.authorityRemaining();
    expect(initialRemaining).toBeGreaterThan(50000);
    
    // Degrade T-state
    node.forceTState(TState.T1);
    
    // Window should be shrunk (70% of original)
    const afterDegradation = node.authorityRemaining();
    expect(afterDegradation).toBeLessThan(initialRemaining);
  });
});

describe('Reputation System', () => {
  it('should increase reputation on success', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    
    // Track a peer
    node.reputation.track('peer-1');
    const initial = node.reputation.getScore('peer-1');
    
    // Record successes
    node.reputation.recordSuccess('peer-1');
    node.reputation.recordSuccess('peer-1');
    node.reputation.recordSuccess('peer-1');
    
    const after = node.reputation.getScore('peer-1');
    expect(after).toBeGreaterThan(initial);
  });

  it('should decrease reputation on failure', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    
    node.reputation.track('peer-1');
    node.reputation.recordSuccess('peer-1');
    node.reputation.recordSuccess('peer-1');
    const afterSuccess = node.reputation.getScore('peer-1');
    
    node.reputation.recordFailure('peer-1');
    const afterFailure = node.reputation.getScore('peer-1');
    
    expect(afterFailure).toBeLessThan(afterSuccess);
  });
});

describe('Quarantine System', () => {
  it('should quarantine and release peers', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    
    expect(node.quarantine.isQuarantined('peer-1')).toBe(false);
    
    node.quarantine.quarantine('peer-1', DriftReason.BELIEF_DIVERGENCE);
    expect(node.quarantine.isQuarantined('peer-1')).toBe(true);
    
    node.quarantine.release('peer-1');
    expect(node.quarantine.isQuarantined('peer-1')).toBe(false);
  });

  it('should apply exponential backoff for repeat offenders', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    
    const entry1 = node.quarantine.quarantine('peer-1', DriftReason.HOLD_TOO_LONG);
    const duration1 = entry1.expiresAt - entry1.quarantinedAt;
    
    node.quarantine.release('peer-1');
    
    const entry2 = node.quarantine.quarantine('peer-1', DriftReason.HOLD_TOO_LONG);
    const duration2 = entry2.expiresAt - entry2.quarantinedAt;
    
    expect(duration2).toBe(duration1 * 2);
  });
});

describe('Belief Store', () => {
  it('should apply signals and track history', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    
    // Publish a belief
    await node.publishBelief('claim-1', 'strengthen', 0.8);
    
    const belief = node.beliefs.get('claim-1');
    expect(belief).toBeDefined();
    expect(belief!.stance).toBe('strengthen');
    expect(belief!.confidence).toBe(0.8);
    
    const history = node.beliefs.getHistory('claim-1');
    expect(history).toBeDefined();
    expect(history!.entries.length).toBeGreaterThan(0);
  });
});

describe('Conflict Detection', () => {
  it('should detect conflicts when peers disagree', async () => {
    const { transports } = createMemorySwarm(3);
    const identities = await Promise.all([
      generateIdentity(),
      generateIdentity(),
      generateIdentity(),
    ]);
    
    const node = new SwarmNode(transports[0], identities[0].privateKeyHex);
    
    // Simulate conflicting observations
    node.conflicts.observeBelief('peer-1', 'claim-1', 'strengthen', 0.9, Date.now());
    node.conflicts.observeBelief('peer-2', 'claim-1', 'weaken', 0.9, Date.now());
    
    const record = node.conflicts.get('claim-1');
    expect(record).toBeDefined();
    expect(record!.conflictScore).toBeGreaterThan(0);
  });
});

describe('Drift Detection', () => {
  it('should detect hold drift', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex, {
      holdDriftThresholdMs: 100, // Very short for testing
    });
    
    node.drift.track('peer-1');
    node.drift.startHold('peer-1', Date.now() - 200); // Started 200ms ago
    
    const events = node.drift.check(new Map(), Date.now());
    
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe(DriftReason.HOLD_TOO_LONG);
  });

  it('should detect belief divergence', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex, {
      beliefDivergenceThreshold: 0.5,
    });
    
    node.drift.track('peer-1');
    node.drift.updateBelief('peer-1', 'claim-1', 'strengthen', 0.9);
    
    // Consensus says weaken
    const consensus = new Map([
      ['claim-1', { stance: 'weaken' as const, confidence: 0.9 }],
    ]);
    
    const events = node.drift.check(consensus, Date.now());
    
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe(DriftReason.BELIEF_DIVERGENCE);
  });
});

describe('Audit Log', () => {
  it('should maintain hash chain integrity', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    node.start();
    
    await node.publishBelief('claim-1', 'strengthen', 0.8);
    await node.publishBelief('claim-2', 'weaken', 0.7);
    
    const { valid } = node.audit.verify();
    expect(valid).toBe(true);
  });

  it('should trace provenance for claims', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    node.start();
    
    await node.publishBelief('claim-1', 'strengthen', 0.8);
    await node.publishBelief('claim-1', 'strengthen', 0.9);
    
    const chain = node.audit.traceProvenance('claim-1');
    expect(chain.entries.length).toBeGreaterThan(0);
  });
});

describe('Full Swarm Scenario', () => {
  it('should coordinate beliefs across nodes', async () => {
    const { transports } = createMemorySwarm(3);
    const identities = await Promise.all([
      generateIdentity(),
      generateIdentity(),
      generateIdentity(),
    ]);
    
    const nodes = identities.map((id, i) => 
      new SwarmNode(transports[i], id.privateKeyHex)
    );
    
    // Start all nodes
    nodes.forEach(n => n.start());
    
    // Let them discover each other
    for (let i = 0; i < 5; i++) {
      await Promise.all(nodes.map(n => n.processTick()));
      await new Promise(r => setTimeout(r, 50));
    }
    
    // Node 0 publishes a belief
    await nodes[0].publishBelief('shared-claim', 'strengthen', 0.85);
    
    // Process a few ticks
    for (let i = 0; i < 5; i++) {
      await Promise.all(nodes.map(n => n.processTick()));
      await new Promise(r => setTimeout(r, 50));
    }
    
    // All nodes should have the belief
    for (const node of nodes) {
      const belief = node.beliefs.get('shared-claim');
      expect(belief).toBeDefined();
    }
  });

  it('should handle authority lifecycle', async () => {
    const { transports } = createMemorySwarm(2);
    const identity = await generateIdentity();
    
    const node = new SwarmNode(transports[0], identity.privateKeyHex);
    node.start();
    
    // Request authority
    expect(node.hasAuthority()).toBe(false);
    const requestId = node.requestAuthority('engage-zone-alpha', 'threat detected');
    expect(requestId).not.toBeNull();
    
    // Grant authority
    const window = node.grantAuthority(requestId!);
    expect(window).not.toBeNull();
    expect(node.hasAuthority()).toBe(true);
    
    // Record some successes
    node.patterns.recordSuccess();
    node.patterns.recordSuccess();
    
    // Check status
    const status = node.status();
    expect(status.hasAuthority).toBe(true);
    expect(status.authorityRemaining).toBeGreaterThan(0);
  });
});

describe('Sybil Resistance', () => {
  it('should limit influence of new peers', async () => {
    const { transports } = createMemorySwarm(5);
    const identities = await Promise.all(
      Array(5).fill(0).map(() => generateIdentity())
    );
    
    const node = new SwarmNode(transports[0], identities[0].privateKeyHex);
    
    // Check admission for new peer
    const decision = node.admission.checkAdmission('new-peer', 0);
    expect(decision.allowed).toBe(true);
    expect(decision.influence).toBe(0.1); // New peer influence
    
    // Established peer should have more influence
    node.reputation.track('established-peer');
    for (let i = 0; i < 10; i++) {
      node.reputation.recordSuccess('established-peer');
      node.reputation.recordConsistency('established-peer');
    }
    
    const establishedInfluence = node.reputation.getInfluence('established-peer');
    expect(establishedInfluence).toBeGreaterThan(0.1);
  });
});
