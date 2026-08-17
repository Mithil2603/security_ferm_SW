import React, { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function SketchbookOfUsPreview() {
  const [flowers, setFlowers] = useState([]);
  const [message, setMessage] = useState('Tap anywhere to grow a little memory with me');
  const counterRef = useRef(null);

  const handleCanvasClick = (e) => {
    const id = Date.now();
    const newFlower = {
      id,
      x: e.clientX,
      y: e.clientY,
    };

    setFlowers((prev) => [...prev, newFlower]);
    setMessage('A tiny bloom for the girl who makes life feel softer');

    setTimeout(() => {
      setFlowers((prev) => prev.filter((f) => f.id !== id));
    }, 1300);
  };

  useEffect(() => {
    const hearts = document.querySelectorAll('.floating-heart');

    hearts.forEach((heart) => {
      const randomDelay = Math.random() * 4;
      const randomDuration = 10 + Math.random() * 14;
      const randomX = Math.random() * 100 - 50;

      gsap.to(heart, {
        y: '-110vh',
        x: `+=${randomX}`,
        rotation: 360 + Math.random() * 360,
        opacity: 0,
        duration: randomDuration,
        delay: randomDelay,
        repeat: -1,
        ease: 'none',
      });
    });
  }, []);

  useEffect(() => {
    const trigger = ScrollTrigger.create({
      trigger: counterRef.current,
      start: 'center center',
      onEnter: () => {
        gsap.to(
          { value: 0 },
          {
            value: 365,
            duration: 3,
            ease: 'power3.out',
            onUpdate: function () {
              if (counterRef.current) {
                counterRef.current.innerHTML = Math.floor(this.targets()[0].value);
              }
            },
          }
        );
      },
      once: true,
    });

    return () => trigger.kill();
  }, []);

  useEffect(() => {
    const svg = document.querySelector('.story-svg');
    if (!svg) return;

    const paths = svg.querySelectorAll('path');
    paths.forEach((path) => {
      const length = path.getTotalLength();
      gsap.set(path, {
        strokeDasharray: length,
        strokeDashoffset: length,
      });

      ScrollTrigger.create({
        trigger: svg,
        start: 'top center',
        end: 'bottom center',
        onUpdate: (self) => {
          gsap.to(path, {
            strokeDashoffset: length * (1 - self.progress),
            duration: 0.1,
          });
        },
      });
    });
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(251,207,232,0.4),_transparent_35%),linear-gradient(135deg,_#fff7fb_0%,_#ffffff_45%,_#fff1f2_100%)] text-gray-800">
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {[...Array(18)].map((_, i) => (
          <div
            key={i}
            className="floating-heart absolute text-pink-200/70 text-3xl opacity-60"
            style={{
              left: `${Math.random() * 100}%`,
              top: '110vh',
            }}
          >
            ♥
          </div>
        ))}
      </div>

      <section
        onClick={handleCanvasClick}
        className="relative z-10 flex min-h-screen w-full cursor-crosshair flex-col items-center justify-center overflow-hidden px-6 py-16 text-center"
      >
        <div className="mb-8 rounded-full border border-rose-200/70 bg-white/70 px-4 py-2 text-sm uppercase tracking-[0.35em] text-rose-500 shadow-sm backdrop-blur">
          For my favorite girl
        </div>
        <h1 className="mb-4 max-w-4xl text-5xl font-semibold leading-tight text-gray-800 sm:text-6xl md:text-7xl">
          You make ordinary days feel like a fairytale.
        </h1>
        <p className="mb-8 max-w-2xl text-lg leading-8 text-gray-600 sm:text-xl">
          This little page is for you—because your laugh, your softness, and the way you make everything brighter deserve something beautiful.
        </p>
        <p className="max-w-xl rounded-2xl border border-rose-100 bg-white/80 px-6 py-4 text-base text-rose-600 shadow-lg backdrop-blur sm:text-lg">
          {message}
        </p>

        {flowers.map((flower) => (
          <GrowingFlower key={flower.id} x={flower.x} y={flower.y} />
        ))}
      </section>

      <section className="relative z-20 px-6 py-20 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            {
              title: 'Your laugh',
              copy: 'The kind that turns even the quietest moments into something I want to keep forever.',
            },
            {
              title: 'Your heart',
              copy: 'Soft, warm, and steady—the kind that makes me feel safe and seen.',
            },
            {
              title: 'Us',
              copy: 'The little world we are building, one gentle memory at a time.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-3xl border border-rose-100 bg-white/80 p-8 shadow-[0_20px_60px_-20px_rgba(244,114,182,0.35)] backdrop-blur">
              <h3 className="mb-3 text-2xl font-serif text-gray-800">{item.title}</h3>
              <p className="leading-7 text-gray-600">{item.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-20 px-6 py-16 text-center sm:px-8">
        <p className="mb-4 text-sm uppercase tracking-[0.3em] text-rose-400">Our story</p>
        <h2 className="mb-6 text-4xl font-serif text-gray-800 sm:text-5xl">How we became us</h2>
        <p className="mx-auto max-w-2xl text-lg leading-8 text-gray-600">
          Every small moment with you feels worth cherishing, and this is just a tiny glimpse of the love I feel.
        </p>
      </section>

      <section className="relative z-20 flex justify-center px-6 py-12 sm:px-8">
        <div className="flex h-[90vh] w-full max-w-2xl flex-col justify-between">
          <svg viewBox="0 0 400 1200" className="story-svg mx-auto h-full w-full max-w-lg" preserveAspectRatio="xMidYMid meet">
            <g>
              <circle cx="50" cy="100" r="8" stroke="#ec4899" strokeWidth="2" fill="none" />
              <circle cx="350" cy="100" r="8" stroke="#f472b6" strokeWidth="2" fill="none" />
              <path d="M 60 100 L 340 100" stroke="#e0abfc" strokeWidth="2" fill="none" />
              <text x="200" y="150" textAnchor="middle" className="text-xs" fill="#be185d">
                The first hello
              </text>
            </g>

            <g>
              <path d="M 100 250 Q 200 200 300 250" stroke="#f472b6" strokeWidth="3" fill="none" />
              <circle cx="100" cy="250" r="6" fill="#ec4899" />
              <circle cx="300" cy="250" r="6" fill="#ec4899" />
              <text x="200" y="310" textAnchor="middle" className="text-xs" fill="#be185d">
                Your smile made everything lighter
              </text>
            </g>

            <g>
              <path d="M 150 400 L 150 500 L 250 500 L 250 400" stroke="#e0abfc" strokeWidth="2" fill="none" />
              <circle cx="150" cy="380" r="5" fill="#a21caf" />
              <circle cx="250" cy="380" r="5" fill="#a21caf" />
              <text x="200" y="560" textAnchor="middle" className="text-xs" fill="#be185d">
                Long talks and soft laughter
              </text>
            </g>

            <g>
              <circle cx="200" cy="700" r="40" stroke="#ec4899" strokeWidth="3" fill="none" />
              <path d="M 200 660 L 200 740" stroke="#f472b6" strokeWidth="2" />
              <path d="M 160 700 L 240 700" stroke="#f472b6" strokeWidth="2" />
              <text x="200" y="800" textAnchor="middle" className="text-xs" fill="#be185d">
                The moment I knew you mattered
              </text>
            </g>

            <g>
              <path d="M 100 950 Q 200 900 300 950" stroke="#ec4899" strokeWidth="4" fill="none" />
              <circle cx="100" cy="950" r="8" fill="#ec4899" />
              <circle cx="300" cy="950" r="8" fill="#ec4899" />
              <circle cx="200" cy="900" r="8" fill="#f472b6" />
              <text x="200" y="1050" textAnchor="middle" className="text-xs" fill="#be185d">
                And now, every day feels like home
              </text>
            </g>
          </svg>
        </div>
      </section>

      <section className="relative z-20 flex min-h-screen w-full flex-col items-center justify-center px-6 py-16 text-center sm:px-8">
        <p className="mb-8 text-sm uppercase tracking-[0.3em] text-rose-400">The proof</p>
        <p className="mb-4 text-xl text-gray-700 sm:text-2xl">It has been</p>
        <div
          ref={counterRef}
          className="text-8xl font-black bg-gradient-to-r from-pink-500 via-rose-500 to-orange-400 bg-clip-text text-transparent sm:text-9xl"
        >
          0
        </div>
        <p className="mt-4 text-xl text-gray-700 sm:text-2xl">
          days of loving you
          <br />
          <span className="text-lg text-rose-400">and I would choose you again every single one</span>
        </p>
      </section>

      <section className="relative z-20 flex min-h-screen w-full items-center justify-center px-6 py-16 sm:px-8">
        <LoveLetter />
      </section>
    </div>
  );
}

function GrowingFlower({ x, y }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      gsap.fromTo(
        ref.current,
        { scale: 0, rotation: -45, opacity: 0 },
        {
          scale: 1,
          rotation: 0,
          opacity: 1,
          duration: 1.2,
          ease: 'elastic.out(1, 0.5)',
        }
      );
    }
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute text-4xl md:text-5xl"
      style={{
        left: `${x - 20}px`,
        top: `${y - 20}px`,
      }}
    >
      🌸
    </div>
  );
}

function LoveLetter() {
  const cardRef = useRef(null);

  useEffect(() => {
    if (cardRef.current) {
      gsap.to(cardRef.current, {
        y: -12,
        duration: 3,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }
  }, []);

  return (
    <div
      ref={cardRef}
      className="w-full max-w-3xl rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-[0_25px_80px_-20px_rgba(244,114,182,0.45)] backdrop-blur-xl sm:p-12"
    >
      <h3 className="mb-6 text-3xl font-serif text-gray-800">My love letter to you</h3>
      <div className="space-y-5 text-lg leading-8 text-gray-700">
        <p>
          There is something so beautiful about the way you make my world feel calmer, lighter, and warmer all at once.
        </p>
        <p>
          I love the way your presence turns ordinary moments into memories I never want to lose. The quiet ones, the silly ones, the ones where we are just being ourselves—those are the ones I treasure most.
        </p>
        <p>
          Thank you for being the kind of person who makes love feel easy, safe, and real. Thank you for your patience, your softness, your laughter, and the way you make me feel like I belong.
        </p>
        <p>
          You are my favorite person, my favorite comfort, and my favorite place to come home to. I hope you know how deeply you are loved.
        </p>
      </div>
      <div className="mt-8 border-t border-rose-100 pt-8 text-center text-sm uppercase tracking-[0.3em] text-rose-500">
        Happy Girlfriend Day, my love
      </div>
    </div>
  );
}
