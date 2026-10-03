import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Layers, Zap, MessageSquare, Settings2 } from 'lucide-react';

interface TutorialModalProps {
  onClose: () => void;
}

const SLIDES = [
  {
    title: '这是一个通用角色扮演引擎',
    icon: <Layers size={48} className="text-accent-lantern" />,
    content: (
      <div className="space-y-4">
        <p>它本身<strong>不含任何固定题材</strong>。</p>
        <p>
          世界观、属性、资源、角色，全部由你写的<strong>「世界卡」</strong>决定。
          写一个剑与魔法的世界，它就是奇幻跑团；写一个赛博都市，它就是废土故事。
        </p>
        <p className="text-sm text-text-muted italic">
          你可以从内置示例卡开始，复制一份改成自己的设定。
        </p>
      </div>
    )
  },
  {
    title: '世界观与角色卡',
    icon: <Zap size={48} className="text-accent-grail" />,
    content: (
      <div className="space-y-4">
        <p>在世界卡编辑器里你可以定义：</p>
        <ul className="list-disc list-inside space-y-2 text-left pl-4">
          <li><span className="text-accent-lantern">世界观正文</span>：AI 的设定依据，越具体越不容易跑题。</li>
          <li><span className="text-accent-grail">属性与资源</span>：名字、含义、上限全由你定。</li>
          <li><span className="text-accent-moth">角色卡</span>：可以手写，也可以直接导入 SillyTavern 的 PNG / JSON 角色卡。</li>
        </ul>
        <p className="text-sm text-text-secondary mt-2">
          <span className="text-accent-lantern">提示：</span>
          设定里写清「术语规范」和「不要出现什么」，比堆砌华丽辞藻更能约束模型。
        </p>
      </div>
    )
  },
  {
    title: '怎么玩',
    icon: <MessageSquare size={48} className="text-accent-edge" />,
    content: (
      <div className="space-y-4">
        <p>每回合你会看到 3~4 个<b>建议行动</b>，也可以直接在输入框里<b>自己写任何行动</b>。</p>
        <p>
          叙事 AI 负责把结果演成小说；另一个结算 AI 负责把剧情里发生的事
          转成数值变化、物品、线索与人物关系。
        </p>
        <p className="text-sm text-text-muted">
          数值归零不一定等于游戏结束 —— 它更像是故事走向另一种结局的信号。
        </p>
      </div>
    )
  },
  {
    title: '先配好模型',
    icon: <Settings2 size={48} className="text-accent-winter" />,
    content: (
      <div className="space-y-4">
        <p>游戏需要调用大模型，请先在<b>模型设置</b>里填好服务商与 API Key。</p>
        <p>支持 DeepSeek、OpenAI、硅基流动、OpenRouter，以及任何 OpenAI 兼容的端点（含本地 Ollama）。</p>
        <div className="p-2 bg-surface/30 rounded text-xs font-mono border-l-2 border-accent-lantern text-left">
          叙事模型与结算模型可以分开选：会用更便宜快速的模型做数值结算，用更擅长写作的模型写剧情。
        </div>
      </div>
    )
  }
];

export function TutorialModal({ onClose }: TutorialModalProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(prev => prev - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="w-full max-w-md bg-surface border border-accent-lantern/20 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
          <span className="text-xs font-mono text-text-muted uppercase tracking-widest">
            新手引导 {currentSlide + 1}/{SLIDES.length}
          </span>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 p-6 md:p-8 flex flex-col items-center text-center overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSlide}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center space-y-6"
            >
              <div className="p-4 bg-black/30 rounded-full border border-white/5 shadow-inner">
                {SLIDES[currentSlide].icon}
              </div>

              <h3 className="text-xl font-serif font-bold text-accent-lantern">
                {SLIDES[currentSlide].title}
              </h3>

              <div className="text-sm md:text-base text-text-secondary leading-relaxed font-serif">
                {SLIDES[currentSlide].content}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="p-4 border-t border-white/5 bg-black/20 flex justify-between items-center">
          <button
            onClick={handlePrev}
            disabled={currentSlide === 0}
            className={`p-2 rounded hover:bg-white/5 transition-colors ${currentSlide === 0 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          >
            <ChevronLeft size={24} className="text-text-muted" />
          </button>

          <div className="flex gap-2">
            {SLIDES.map((_, idx) => (
              <div
                key={idx}
                className={`w-2 h-2 rounded-full transition-all ${idx === currentSlide ? 'bg-accent-lantern w-4' : 'bg-white/20'}`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            className="flex items-center gap-2 px-4 py-2 bg-accent-lantern/10 hover:bg-accent-lantern/20 text-accent-lantern rounded border border-accent-lantern/30 transition-all text-sm font-bold"
          >
            {currentSlide === SLIDES.length - 1 ? '开始' : '下一步'}
            {currentSlide < SLIDES.length - 1 && <ChevronRight size={16} />}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
