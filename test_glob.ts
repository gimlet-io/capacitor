import { matchGlob, matchGlobPatterns, parseGlobFilter, ensureWildcard } from "./src/utils/glob.ts";

// Test basic glob patterns
console.log("Testing basic glob patterns:");
console.log("pod-* matches 'pod-123':", matchGlob("pod-*", "pod-123")); // true
console.log("pod-* matches 'app-123':", matchGlob("pod-*", "app-123")); // false
console.log("pod-? matches 'pod-1':", matchGlob("pod-?", "pod-1")); // true
console.log("pod-? matches 'pod-12':", matchGlob("pod-?", "pod-12")); // false

// Test character classes
console.log("\nTesting character classes:");
console.log("pod-[123] matches 'pod-1':", matchGlob("pod-[123]", "pod-1")); // true
console.log("pod-[123] matches 'pod-4':", matchGlob("pod-[123]", "pod-4")); // false

// Test parsing multiple patterns
console.log("\nTesting pattern parsing:");
console.log("Parse 'pod-*, app-*, !test-*':", parseGlobFilter("pod-*, app-*, !test-*"));

// Test negation
console.log("\nTesting negation:");
console.log("'pod-123' matches 'pod-*, !test-*':", matchGlobPatterns(["pod-*", "!test-*"], "pod-123")); // true
console.log("'test-123' matches 'pod-*, !test-*':", matchGlobPatterns(["pod-*", "!test-*"], "test-123")); // false
console.log("'test-pod' matches 'pod-*, !test-*':", matchGlobPatterns(["pod-*", "!test-*"], "test-pod")); // false (negated)

// Test complex patterns
console.log("\nTesting complex patterns:");
console.log("'app-web-prod' matches 'app-web-*, !*-test':", matchGlobPatterns(["app-web-*", "!*-test"], "app-web-prod")); // true
console.log("'app-web-test' matches 'app-web-*, !*-test':", matchGlobPatterns(["app-web-*", "!*-test"], "app-web-test")); // false

// Test auto-wildcard functionality
console.log("\nTesting auto-wildcard functionality:");
console.log("ensureWildcard('pod'):", ensureWildcard("pod")); // should be 'pod*'
console.log("ensureWildcard('pod*'):", ensureWildcard("pod*")); // should remain 'pod*'
console.log("ensureWildcard('pod?'):", ensureWildcard("pod?")); // should remain 'pod?'
console.log("ensureWildcard('pod[123]'):", ensureWildcard("pod[123]")); // should remain 'pod[123]'

// Test non-wildcard patterns with auto-wildcard
console.log("\nTesting non-wildcard patterns with auto-wildcard:");
console.log("'pod' matches 'pod-123':", matchGlob("pod", "pod-123")); // true with auto-wildcard
console.log("'pod' matches 'pod':", matchGlob("pod", "pod")); // true
console.log("'pod' matches 'pod-web':", matchGlob("pod", "pod-web")); // true with auto-wildcard
console.log("'pod' matches 'app-pod':", matchGlob("pod", "app-pod")); // false even with auto-wildcard
