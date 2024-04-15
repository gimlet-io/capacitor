import { getAppPort, getHostPort } from "./Service"
import {test, expect} from "@jest/globals";

test('should return undefined for app port', () => {
  const port = getAppPort(undefined)

  expect(port).toBeUndefined();
});

test('should return undefined for host port', () => {
  const port = getHostPort(undefined)

  expect(port).toBeUndefined();
});

test('should return "80" for app port', () => {
  const ports = [{}];
  const port = getAppPort(ports)

  expect(port).toEqual("80");
});

test('should return "5000" for app port', () => {
  const ports = [{"port": 5000}];
  const port = getAppPort(ports)

  expect(port).toEqual("5000");
});

test('should return "5000" for host port', () => {
  const ports = [{"port": 5000}];
  const port = getHostPort(ports)

  expect(port).toEqual("5000");
});

test('should return "10081" for host port', () => {
  const ports = [{"port": 80}];
  const port = getHostPort(ports)

  expect(port).toEqual("10081");
});

test('should return "10090 for host port', () => {
  const ports = [{"port": 90}];
  const port = getHostPort(ports)

  expect(port).toEqual("10090");
});

test('should return "10200 for host port', () => {
  const ports = [{"port": 200}];
  const port = getHostPort(ports)

  expect(port).toEqual("10200");
});
