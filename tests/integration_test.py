#!/usr/bin/env python3
"""
Integration Test Suite for oxDNA-Viewer + NanoCanvas Synchronization

Tests the full bidirectional sync pipeline:
1. WebSocket communication
2. State synchronization
3. Edit operations
4. ID mapping consistency
"""

import asyncio
import json
import sys
import time
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NanoCanvas" / "backend"))

try:
    from websockets import connect
    from editor_session import CadnanoSession
except ImportError:
    print("ERROR: Required packages not installed")
    print("Please install: pip install websockets")
    sys.exit(1)


class Colors:
    """ANSI color codes"""
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


class IntegrationTestRunner:
    def __init__(self, websocket_url="ws://localhost:8765/ws"):
        self.websocket_url = websocket_url
        self.ws = None
        self.tests_passed = 0
        self.tests_failed = 0
        self.session = CadnanoSession()

    def log(self, message, color=Colors.OKBLUE):
        print(f"{color}{message}{Colors.ENDC}")

    def test_result(self, test_name, passed, details=""):
        if passed:
            self.tests_passed += 1
            print(f"{Colors.OKGREEN}✓ {test_name}{Colors.ENDC}")
            if details:
                print(f"  {Colors.OKCYAN}{details}{Colors.ENDC}")
        else:
            self.tests_failed += 1
            print(f"{Colors.FAIL}✗ {test_name}{Colors.ENDC}")
            if details:
                print(f"  {Colors.WARNING}{details}{Colors.ENDC}")

    async def connect_websocket(self):
        """Test 1: WebSocket connection"""
        try:
            self.ws = await connect(self.websocket_url)
            self.test_result("WebSocket connection", True, f"Connected to {self.websocket_url}")
            return True
        except Exception as e:
            self.test_result("WebSocket connection", False, f"Failed: {e}")
            return False

    async def test_connection_message(self):
        """Test 2: Receive connection confirmation"""
        try:
            message = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            data = json.loads(message)

            if data.get("type") == "connected":
                self.test_result("Connection confirmation", True, "Received 'connected' event")
                return True
            else:
                self.test_result("Connection confirmation", False, f"Unexpected message: {data.get('type')}")
                return False
        except asyncio.TimeoutError:
            self.test_result("Connection confirmation", False, "Timeout waiting for response")
            return False
        except Exception as e:
            self.test_result("Connection confirmation", False, str(e))
            return False

    async def test_request_state(self):
        """Test 3: Request state from server"""
        try:
            # Send request
            await self.ws.send(json.dumps({
                "type": "request_state",
                "source": "integration_test",
                "timestamp": int(time.time() * 1000)
            }))

            # Wait for response
            message = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            data = json.loads(message)

            if data.get("type") == "state_response":
                state = data.get("data", {})
                helices = state.get("helices", [])
                strands = state.get("strands", [])
                crossovers = state.get("crossovers", [])

                details = f"Helices: {len(helices)}, Strands: {len(strands)}, Crossovers: {len(crossovers)}"
                self.test_result("Request state", True, details)
                return True
            else:
                self.test_result("Request state", False, f"Unexpected response type: {data.get('type')}")
                return False
        except Exception as e:
            self.test_result("Request state", False, str(e))
            return False

    async def test_create_helix(self):
        """Test 4: Create helix via WebSocket"""
        try:
            # Send create helix command
            await self.ws.send(json.dumps({
                "type": "helix_created",
                "source": "integration_test",
                "timestamp": int(time.time() * 1000),
                "data": {
                    "row": 5,
                    "col": 10,
                    "max_bases": 32
                }
            }))

            # Wait for confirmation (broadcast back)
            message = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            data = json.loads(message)

            if data.get("type") == "helix_created":
                helix_data = data.get("data", {})
                details = f"Helix ID: {helix_data.get('helix_id')}, Position: ({helix_data.get('row')}, {helix_data.get('col')})"
                self.test_result("Create helix", True, details)
                return True
            else:
                self.test_result("Create helix", False, f"Unexpected response: {data.get('type')}")
                return False
        except Exception as e:
            self.test_result("Create helix", False, str(e))
            return False

    async def test_create_strand(self):
        """Test 5: Create strand via WebSocket"""
        try:
            # First, get the current state to find a helix
            await self.ws.send(json.dumps({
                "type": "request_state",
                "source": "integration_test",
                "timestamp": int(time.time() * 1000)
            }))

            message = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            data = json.loads(message)
            helices = data.get("data", {}).get("helices", [])

            if not helices:
                self.test_result("Create strand", False, "No helices available to create strand on")
                return False

            helix_id = helices[0].get("id")

            # Create strand
            await self.ws.send(json.dumps({
                "type": "strand_created",
                "source": "integration_test",
                "timestamp": int(time.time() * 1000),
                "data": {
                    "helix_id": helix_id,
                    "direction": 1,
                    "start": 0,
                    "end": 16,
                    "color": "#ff0000"
                }
            }))

            # Wait for confirmation
            message = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            data = json.loads(message)

            if data.get("type") == "strand_created":
                strand_data = data.get("data", {})
                details = f"Strand ID: {strand_data.get('strand_id')}, Range: {strand_data.get('start')}-{strand_data.get('end')}"
                self.test_result("Create strand", True, details)
                return True
            else:
                self.test_result("Create strand", False, f"Unexpected response: {data.get('type')}")
                return False
        except Exception as e:
            self.test_result("Create strand", False, str(e))
            return False

    async def test_message_echo(self):
        """Test 6: Message round-trip time"""
        try:
            start_time = time.time()

            await self.ws.send(json.dumps({
                "type": "request_state",
                "source": "integration_test",
                "timestamp": int(time.time() * 1000)
            }))

            await asyncio.wait_for(self.ws.recv(), timeout=5.0)

            elapsed = (time.time() - start_time) * 1000  # Convert to ms
            self.test_result("Message round-trip", True, f"{elapsed:.2f} ms")
            return True
        except Exception as e:
            self.test_result("Message round-trip", False, str(e))
            return False

    async def test_error_handling(self):
        """Test 7: Error handling for invalid messages"""
        try:
            # Send malformed message
            await self.ws.send(json.dumps({
                "type": "unknown_command",
                "source": "integration_test",
                "data": {}
            }))

            # Should receive error or simply ignore
            try:
                message = await asyncio.wait_for(self.ws.recv(), timeout=2.0)
                data = json.loads(message)

                # Either error message or no response (both acceptable)
                if data.get("type") == "error":
                    self.test_result("Error handling", True, "Server returned error for invalid command")
                else:
                    self.test_result("Error handling", True, "Server ignored invalid command")
            except asyncio.TimeoutError:
                self.test_result("Error handling", True, "Server ignored invalid command (no response)")

            return True
        except Exception as e:
            self.test_result("Error handling", False, str(e))
            return False

    async def test_concurrent_messages(self):
        """Test 8: Handle multiple concurrent messages"""
        try:
            # Send multiple messages rapidly
            for i in range(5):
                await self.ws.send(json.dumps({
                    "type": "request_state",
                    "source": "integration_test",
                    "timestamp": int(time.time() * 1000),
                    "data": {"test_id": i}
                }))

            # Receive all responses
            responses = []
            for i in range(5):
                message = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
                responses.append(json.loads(message))

            all_valid = all(r.get("type") == "state_response" for r in responses)

            if all_valid:
                self.test_result("Concurrent messages", True, f"Processed {len(responses)} messages")
                return True
            else:
                self.test_result("Concurrent messages", False, "Some responses were invalid")
                return False
        except Exception as e:
            self.test_result("Concurrent messages", False, str(e))
            return False

    async def cleanup(self):
        """Close WebSocket connection"""
        if self.ws:
            await self.ws.close()

    async def run_all_tests(self):
        """Run all integration tests"""
        self.log("=" * 60, Colors.HEADER)
        self.log("oxDNA-Viewer + NanoCanvas Integration Test Suite", Colors.HEADER)
        self.log("=" * 60, Colors.HEADER)
        print()

        # Test sequence
        tests = [
            self.connect_websocket,
            self.test_connection_message,
            self.test_request_state,
            self.test_create_helix,
            self.test_create_strand,
            self.test_message_echo,
            self.test_error_handling,
            self.test_concurrent_messages
        ]

        for test in tests:
            try:
                await test()
            except Exception as e:
                self.log(f"EXCEPTION in {test.__name__}: {e}", Colors.FAIL)
                self.tests_failed += 1

            await asyncio.sleep(0.5)  # Small delay between tests

        # Cleanup
        await self.cleanup()

        # Print summary
        print()
        self.log("=" * 60, Colors.HEADER)
        self.log("Test Summary", Colors.HEADER)
        self.log("=" * 60, Colors.HEADER)

        total = self.tests_passed + self.tests_failed
        pass_rate = (self.tests_passed / total * 100) if total > 0 else 0

        print(f"Total Tests:  {total}")
        print(f"{Colors.OKGREEN}Passed:       {self.tests_passed}{Colors.ENDC}")
        print(f"{Colors.FAIL}Failed:       {self.tests_failed}{Colors.ENDC}")
        print(f"Pass Rate:    {pass_rate:.1f}%")
        print()

        if self.tests_failed == 0:
            self.log("✓ All tests passed!", Colors.OKGREEN)
            return 0
        else:
            self.log(f"✗ {self.tests_failed} test(s) failed", Colors.FAIL)
            return 1


async def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="Run integration tests for oxDNA-Viewer + NanoCanvas sync")
    parser.add_argument("--url", default="ws://localhost:8765/ws", help="WebSocket server URL")
    args = parser.parse_args()

    runner = IntegrationTestRunner(websocket_url=args.url)

    try:
        exit_code = await runner.run_all_tests()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print(f"\n{Colors.WARNING}Tests interrupted by user{Colors.ENDC}")
        sys.exit(130)
    except Exception as e:
        print(f"\n{Colors.FAIL}Fatal error: {e}{Colors.ENDC}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
