"use client";

import { useState } from "react";

type Todo = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
};

type Filter = "all" | "active" | "completed";

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const addTodo = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setTodos((prev) => [
      {
        id: crypto.randomUUID(),
        text: trimmed,
        completed: false,
        createdAt: new Date(),
      },
      ...prev,
    ]);
    setInputValue("");
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  const deleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) addTodo();
  };

  const filteredTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16">
      {/* Header */}
      <div className="w-full max-w-lg mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-stone-800">
          やること
        </h1>
        <p className="mt-1 text-sm text-stone-400">
          {activeCount > 0
            ? `残り ${activeCount} 件`
            : todos.length === 0
            ? "タスクを追加してみましょう"
            : "すべて完了しました 🎉"}
        </p>
      </div>

      {/* Input */}
      <div className="w-full max-w-lg flex gap-2 mb-6">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="新しいタスクを入力..."
          className="flex-1 px-4 py-3 rounded-xl bg-white border border-stone-200 text-stone-800 placeholder-stone-300 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
        />
        <button
          onClick={addTodo}
          disabled={!inputValue.trim()}
          className="px-5 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium shadow-sm hover:bg-stone-700 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          追加
        </button>
      </div>

      {/* Filter tabs */}
      {todos.length > 0 && (
        <div className="w-full max-w-lg flex gap-1 mb-4">
          {(
            [
              { key: "all", label: `すべて (${todos.length})` },
              { key: "active", label: `未完了 (${activeCount})` },
              { key: "completed", label: `完了 (${completedCount})` },
            ] as { key: Filter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === key
                  ? "bg-stone-800 text-white"
                  : "bg-transparent text-stone-400 hover:text-stone-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Todo list */}
      <div className="w-full max-w-lg flex flex-col gap-2">
        {filteredTodos.length === 0 && todos.length > 0 && (
          <p className="text-center text-sm text-stone-300 py-8">
            該当するタスクはありません
          </p>
        )}

        {filteredTodos.map((todo) => (
          <div
            key={todo.id}
            className={`group flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white border shadow-sm transition-all ${
              todo.completed
                ? "border-stone-100 opacity-60"
                : "border-stone-200 hover:border-stone-300"
            }`}
          >
            {/* Checkbox */}
            <button
              onClick={() => toggleTodo(todo.id)}
              className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                todo.completed
                  ? "bg-stone-800 border-stone-800"
                  : "border-stone-300 hover:border-stone-500"
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

            {/* Text */}
            <span
              className={`flex-1 text-sm leading-relaxed ${
                todo.completed
                  ? "line-through text-stone-400"
                  : "text-stone-700"
              }`}
            >
              {todo.text}
            </span>

            {/* Delete button */}
            <button
              onClick={() => deleteTodo(todo.id)}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg text-stone-300 hover:text-red-400 hover:bg-red-50 transition-all"
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
        ))}
      </div>

      {/* Footer hint */}
      {todos.length === 0 && (
        <div className="mt-16 text-center text-stone-300">
          <div className="text-5xl mb-4">✓</div>
          <p className="text-sm">タスクを追加して今日を整理しよう</p>
        </div>
      )}
    </main>
  );
}
