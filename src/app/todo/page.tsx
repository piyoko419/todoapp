"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type DueDate = "today" | "tomorrow" | "later";

type Todo = {
  id: string;
  text: string;
  completed: boolean;
  dueDate: DueDate;
};

const SECTIONS: {
  key: DueDate;
  label: string;
  accent: string;
  badge: string;
  dot: string;
}[] = [
  {
    key: "today",
    label: "今日",
    accent: "text-violet-500",
    badge: "bg-violet-100 text-violet-600 border-violet-200",
    dot: "bg-violet-400",
  },
  {
    key: "tomorrow",
    label: "明日",
    accent: "text-sky-500",
    badge: "bg-sky-100 text-sky-600 border-sky-200",
    dot: "bg-sky-400",
  },
  {
    key: "later",
    label: "それ以降",
    accent: "text-emerald-500",
    badge: "bg-emerald-100 text-emerald-600 border-emerald-200",
    dot: "bg-emerald-400",
  },
];

function SortableTaskItem({
  todo,
  onToggle,
  onDelete,
  onEdit,
}: {
  todo: Todo;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSave = () => {
    const trimmed = editText.trim();
    if (trimmed) onEdit(trimmed);
    else setEditText(todo.text);
    setIsEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
        isDragging
          ? "bg-white border-violet-200 shadow-lg shadow-violet-100"
          : "bg-white border-slate-100 hover:border-violet-200 hover:shadow-sm"
      }`}
    >
      {/* ドラッグハンドル */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 text-slate-200 hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none transition-colors"
        aria-label="並び替え"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
          <circle cx="5" cy="4" r="1.2" />
          <circle cx="11" cy="4" r="1.2" />
          <circle cx="5" cy="8" r="1.2" />
          <circle cx="11" cy="8" r="1.2" />
          <circle cx="5" cy="12" r="1.2" />
          <circle cx="11" cy="12" r="1.2" />
        </svg>
      </button>

      {/* チェックボックス */}
      <button
        onClick={onToggle}
        className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          todo.completed
            ? "bg-violet-400 border-violet-400"
            : "border-slate-200 hover:border-violet-300"
        }`}
        aria-label={todo.completed ? "未完了に戻す" : "完了にする"}
      >
        {todo.completed && (
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </button>

      {/* テキスト / 編集 */}
      {isEditing ? (
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave();
            if (e.key === "Escape") {
              setEditText(todo.text);
              setIsEditing(false);
            }
          }}
          className="flex-1 bg-violet-50 text-slate-700 text-sm px-2 py-1 rounded-lg outline-none border border-violet-300"
        />
      ) : (
        <span
          onClick={() => !todo.completed && setIsEditing(true)}
          title={todo.completed ? undefined : "クリックして編集"}
          className={`flex-1 text-sm leading-relaxed transition-colors ${
            todo.completed
              ? "line-through text-slate-300 cursor-default"
              : "text-slate-600 cursor-pointer hover:text-slate-900"
          }`}
        >
          {todo.text}
        </span>
      )}

      {/* 削除 */}
      <button
        onClick={onDelete}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-xl text-slate-200 hover:text-red-400 hover:bg-red-50 transition-all"
        aria-label="削除"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedDue, setSelectedDue] = useState<DueDate>("today");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const addTodo = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setTodos((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: trimmed,
        completed: false,
        dueDate: selectedDue,
      },
    ]);
    setInputValue("");
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const editTodo = (id: string, text: string) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeTodo = todos.find((t) => t.id === active.id);
    const overTodo = todos.find((t) => t.id === over.id);
    if (!activeTodo || !overTodo || activeTodo.dueDate !== overTodo.dueDate)
      return;

    setTodos((prev) => {
      const oldIndex = prev.findIndex((t) => t.id === active.id);
      const newIndex = prev.findIndex((t) => t.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const activeCount = todos.filter((t) => !t.completed).length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-50 via-sky-50 to-emerald-50 px-4 py-12 flex flex-col items-center">
      {/* ヘッダー */}
      <div className="w-full max-w-lg mb-8">
        <h1 className="text-3xl font-bold text-slate-700 tracking-tight">
          やること
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {activeCount > 0
            ? `${activeCount} 件の未完了タスク`
            : todos.length === 0
            ? "タスクを追加してみましょう"
            : "すべて完了しました 🎉"}
        </p>
      </div>

      {/* 入力エリア */}
      <div className="w-full max-w-lg mb-10 bg-white/70 backdrop-blur-sm border border-white rounded-3xl p-5 shadow-sm shadow-violet-100">
        {/* セクション選択 */}
        <div className="flex gap-2 mb-3">
          {SECTIONS.map(({ key, label, badge }) => (
            <button
              key={key}
              onClick={() => setSelectedDue(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                selectedDue === key
                  ? badge + " shadow-sm"
                  : "bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* テキスト入力 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) addTodo();
            }}
            placeholder="新しいタスクを入力..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100 text-slate-700 placeholder-slate-300 text-sm focus:outline-none focus:border-violet-300 focus:bg-white transition"
          />
          <button
            onClick={addTodo}
            disabled={!inputValue.trim()}
            className="px-5 py-2.5 rounded-xl bg-violet-400 text-white text-sm font-medium hover:bg-violet-500 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shadow-violet-200"
          >
            追加
          </button>
        </div>
      </div>

      {/* セクション一覧 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="w-full max-w-lg space-y-8">
          {SECTIONS.map(({ key, label, accent, dot }) => {
            const sectionTodos = todos.filter((t) => t.dueDate === key);
            const sectionActive = sectionTodos.filter(
              (t) => !t.completed
            ).length;

            return (
              <section key={key}>
                {/* セクションヘッダー */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  <span className={`text-xs font-bold tracking-widest uppercase ${accent}`}>
                    {label}
                  </span>
                  <div className="flex-1 h-px bg-white/80" />
                  {sectionTodos.length > 0 && (
                    <span className="text-xs text-slate-300">
                      {sectionActive}/{sectionTodos.length}
                    </span>
                  )}
                </div>

                {sectionTodos.length === 0 ? (
                  <p className="text-center text-slate-300 text-sm py-3">
                    タスクなし
                  </p>
                ) : (
                  <SortableContext
                    items={sectionTodos.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {sectionTodos.map((todo) => (
                        <SortableTaskItem
                          key={todo.id}
                          todo={todo}
                          onToggle={() => toggleTodo(todo.id)}
                          onDelete={() => deleteTodo(todo.id)}
                          onEdit={(text) => editTodo(todo.id, text)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </section>
            );
          })}
        </div>
      </DndContext>

      {/* 空状態 */}
      {todos.length === 0 && (
        <div className="mt-20 text-center text-slate-300">
          <div className="text-5xl mb-4">✓</div>
          <p className="text-sm">タスクを追加して今日を整理しよう</p>
        </div>
      )}
    </main>
  );
}
