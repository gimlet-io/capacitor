class Capacitor < Formula
  desc "Kubernetes GUI for GitOps with Flux and Helm"
  homepage "https://github.com/gimlet-io/capacitor"
  version "0.14.0-rc.2"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/gimlet-io/capacitor/releases/download/0.14.0-rc.2/next-Darwin-arm64"
      sha256 "65497d0d853d4f9873d59744915eb8ec6035e4cb0a78f4007cfed5d19bbd70ee"
    else
      odie "Only arm64 macOS builds are currently provided"
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "https://github.com/gimlet-io/capacitor/releases/download/0.14.0-rc.2/next-Linux-x86_64"
      sha256 "90242961f00fcc021b99b55426c3bc0c70aca2e23ada71dadbab97e45a657a5f"
    else
      odie "Only x86_64 Linux builds are currently provided"
    end
  end

  def install
    if OS.mac?
      bin.install "next-Darwin-arm64" => "capacitor"
    elsif OS.linux?
      bin.install "next-Linux-x86_64" => "capacitor"
    else
      odie "Unsupported platform for capacitor formula"
    end
  end

  test do
    assert_match version.to_s, shell_output("\#{bin}/capacitor version")
  end
end
