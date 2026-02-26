import { createContext, useContext, useState, useEffect } from 'react';

const BranchContext = createContext(null);

const SESSION_KEY = 'activeBranch';

export function BranchProvider({ children }) {
  const [branch, setBranchState] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  function setBranch(b) {
    setBranchState(b);
    if (b) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(b));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  return (
    <BranchContext.Provider value={{ branch, setBranch }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  return useContext(BranchContext);
}
