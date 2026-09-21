import Image from "next/image";
import SpotlightReveal from "./components/SpotlightReveal";

// Native pixel size of /Animate_this_living_rock_while.mp4
const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black font-sans">
      <SpotlightReveal
        base={
          <div className="relative h-full w-full">
            <Image
              src="/rock-lifeless.jpg"
              alt="A bare, lifeless rock"
              fill
              priority
              className="object-cover"
              style={{ filter: "grayscale(1) brightness(0.6) contrast(1.1)" }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/10 px-6 text-center">
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                Animation Next
              </h1>
              <p className="max-w-md text-base text-zinc-300 sm:text-lg">
                Move your cursor over the rock to bring it to life.
              </p>
            </div>
          </div>
        }
        reveal={
          <video
            className="h-full w-full object-cover"
            src="/Animate_this_living_rock_while.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          />
        }
        shape="circle"
        radius={220}
        feather={0.4}
        revealOpacity={100}
        followSpeed={0.15}
        revealMode="hover"
        restingPosition="center"
        enterDuration={300}
        exitDuration={400}
        touchBehavior="follow"
        edgeRing={{ enabled: true, color: "#ffffff", thickness: 1.5, opacity: 55 }}
        style={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}
      />
    </div>
  );
}
