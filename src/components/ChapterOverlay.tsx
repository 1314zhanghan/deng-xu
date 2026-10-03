import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/stores/game';
import { useSessionStore } from '@/stores/session';

/**
 * 章节切换过场
 *
 * 原版把四个章节标题写死成密教模拟器的剧本名。
 * 现在标题优先取自世界卡里的章节卡事件，取不到就退化成「第 N 幕」。
 */
export function ChapterOverlay() {
  const { story } = useGameStore();
  const world = useSessionStore(s => s.world);
  const [isVisible, setIsVisible] = useState(false);
  const [currentTitle, setCurrentTitle] = useState('');

  useEffect(() => {
    // 同一章下可能有多个事件，取第一个带标题的作为章节名
    const stage = world?.story.stages.find(
      s => s.chapterId === story.currentChapter && s.title
    );
    setCurrentTitle(stage?.title || `第 ${story.currentChapter} 幕`);
    setIsVisible(true);

    const timer = setTimeout(() => setIsVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [story.currentChapter, world]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 pointer-events-none"
        >
          <div className="text-center space-y-4">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.5, delay: 0.5 }}
              className="h-px bg-gradient-to-r from-transparent via-accent-lantern to-transparent mx-auto max-w-md"
            />
            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="text-4xl md:text-6xl font-serif text-text-primary tracking-widest font-bold"
            >
              {currentTitle}
            </motion.h2>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.5, delay: 0.5 }}
              className="h-px bg-gradient-to-r from-transparent via-accent-lantern to-transparent mx-auto max-w-md"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
