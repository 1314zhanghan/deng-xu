import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface NarrativeViewProps {
  messages: { role: string, content: string }[];
  isTyping?: boolean;
  isAnalyzingData?: boolean;
  streamingContent?: string | null;
  streamingReasoning?: string | null;
}

export function NarrativeView({ messages, isTyping, isAnalyzingData, streamingContent, streamingReasoning }: NarrativeViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);

  useEffect(() => {
    // Use a small timeout to ensure the DOM has updated with the new content
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isTyping, streamingContent, streamingReasoning]);

  return (
    <div className="relative h-full overflow-y-auto scroll-smooth">
      {/*
        ⚠️ 场景背景**不能**放在这个滚动容器里面。
        之前写成 `sticky top-0 h-0` 想让背景不随内容滚动，结果 h-0 把高度设成 0，
        里面 absolute inset-0 的图片 bounding box 变成 656×0 —— 等于完全没画出来。
        正确做法：背景交给外层不滚动的容器（见 App.tsx），这里只负责正文。
      */}
      {/*
        aria-live="polite" 让读屏软件在叙事更新时朗读新内容。
        之前叙事流对读屏完全不可见 —— 这是个纯文字游戏，内容就是唯一的产出，
        对读屏用户来说等于什么都收不到。
        用 polite 而不是 assertive：叙事段落很长，打断当前朗读会很烦。
      */}
      <div
        className="relative p-4 md:p-12 space-y-6 md:space-y-8 font-serif leading-loose text-base md:text-lg"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="叙事内容"
      >
      {messages.map((msg, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`max-w-3xl mx-auto ${msg.role === 'user' ? 'flex justify-end' : ''}`}
        >
          {msg.role === 'user' ? (
            <div className="inline-block bg-surface/10 border-l-2 border-accent-lantern/50 pl-4 py-2 text-base text-text-secondary italic font-mono">
              {msg.content}
            </div>
          ) : msg.role === 'system' ? (
            <div className="border border-accent-lantern/20 bg-black/20 p-4 rounded-sm text-sm font-mono text-accent-lantern/80 flex items-start gap-3">
              <div className="mt-1 text-accent-lantern">✦</div>
              <div className="flex-1 leading-relaxed whitespace-pre-wrap">
                {msg.content.replace(/^> \*\*状态变更\*\*: \n?/, '')}
              </div>
            </div>
          ) : (
            <div className="prose prose-invert prose-lg prose-p:text-text-primary/90 prose-headings:text-accent-lantern prose-strong:text-accent-forge max-w-none drop-shadow-sm">
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          )}
          
          {index < messages.length - 1 && msg.role === 'assistant' && (
            <div className="flex items-center justify-center my-8 opacity-30">
              <div className="h-px w-12 bg-text-muted"></div>
              <div className="mx-2 text-text-muted">✦</div>
              <div className="h-px w-12 bg-text-muted"></div>
            </div>
          )}
        </motion.div>
      ))}

      {(streamingReasoning || streamingContent) && (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto"
        >
            {streamingReasoning && (
                <div className="mb-6 bg-black/20 border-l-2 border-accent-moth/30 rounded-r text-sm text-text-muted font-mono overflow-hidden">
                    <button 
                      onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                      className="w-full flex items-center justify-between p-2 px-4 bg-black/10 hover:bg-black/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 text-accent-moth/60 uppercase tracking-wider text-xs font-bold">
                          <span className="animate-pulse">●</span> 思维链
                      </div>
                      {isThinkingExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    
                    <AnimatePresence>
                      {isThinkingExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-4 pt-2 whitespace-pre-wrap opacity-80 leading-relaxed border-t border-white/5">
                              {streamingReasoning}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                </div>
            )}
            
            {streamingContent && (
                <div className="prose prose-invert prose-lg prose-p:text-text-primary/90 prose-headings:text-accent-lantern prose-strong:text-accent-forge max-w-none drop-shadow-sm">
                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                        {streamingContent}
                    </ReactMarkdown>
                </div>
            )}
        </motion.div>
      )}

      {isAnalyzingData && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center gap-3 py-6 text-accent-lantern/60 font-mono text-xs tracking-[0.2em] uppercase border-t border-white/5 mt-8"
        >
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
               <span className="w-1.5 h-1.5 bg-accent-lantern/50 rounded-full animate-pulse"></span>
               <span className="w-1.5 h-1.5 bg-accent-lantern/50 rounded-full animate-pulse delay-100"></span>
               <span className="w-1.5 h-1.5 bg-accent-lantern/50 rounded-full animate-pulse delay-200"></span>
            </div>
            <span>正在解析因果...</span>
            <div className="flex gap-2">
               <span className="w-1.5 h-1.5 bg-accent-lantern/50 rounded-full animate-pulse delay-200"></span>
               <span className="w-1.5 h-1.5 bg-accent-lantern/50 rounded-full animate-pulse delay-100"></span>
               <span className="w-1.5 h-1.5 bg-accent-lantern/50 rounded-full animate-pulse"></span>
            </div>
          </div>
          <span className="text-[10px] opacity-50">Analyzing Causality</span>
        </motion.div>
      )}
      
      {isTyping && !streamingContent && !streamingReasoning && !isAnalyzingData && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex gap-1 items-center text-accent-moth text-sm"
        >
          <span className="w-2 h-2 bg-accent-moth rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
          <span className="w-2 h-2 bg-accent-moth rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
          <span className="w-2 h-2 bg-accent-moth rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
          <span className="ml-2">命运正在编织...</span>
        </motion.div>
      )}
      <div ref={bottomRef} />
      </div>
    </div>
  );
}
