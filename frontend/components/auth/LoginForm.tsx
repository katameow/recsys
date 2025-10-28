"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Database, Zap, Shield, Search, Brain, Cloud } from "lucide-react";

export function LoginForm() {
  return (
    <div className="space-y-8">
      {/* Logo and Header */}
      <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
            <Brain className="text-white w-5 h-5" />
          </div>
          <span className="text-xl font-semibold text-gray-900">Katalyst</span>
        </div>
        
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-gray-900">RAG-Driven Semantic Recommender</h1>
          <p className="text-lg text-gray-700 leading-relaxed">
            Experience our MVP: A Retrieval-Augmented Generation system for intelligent product discovery.
          </p>
        </div>
      </div>

      {/* Project Description */}
      <div className="space-y-6 py-4">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">About This Project</h2>
          <p className="text-gray-600 leading-relaxed">
            Built on Google Cloud infrastructure, this semantic recommender enhances the shopping experience 
            by leveraging machine learning to help users discover relevant products with personalized 
            content and recommendations.
          </p>
        </div>

        {/* Technology Stack */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-start space-x-3 p-4 bg-teal-50 rounded-lg">
            <Database className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">BigQuery</h3>
              <p className="text-xs text-gray-600">Vector indexing & hybrid search</p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3 p-4 bg-purple-50 rounded-lg">
            <Brain className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">LLM Integration</h3>
              <p className="text-xs text-gray-600">Enhanced search results</p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3 p-4 bg-blue-50 rounded-lg">
            <Zap className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Redis Cache</h3>
              <p className="text-xs text-gray-600">High-performance caching</p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3 p-4 bg-orange-50 rounded-lg">
            <Shield className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Auth System</h3>
              <p className="text-xs text-gray-600">Secure authentication</p>
            </div>
          </div>
        </div>

        {/* Key Features */}
        <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
            <Search className="w-4 h-4 text-teal-600" />
            <span>Key Features</span>
          </h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start">
              <span className="text-teal-600 mr-2">•</span>
              <span>Semantic search with embedding models for intelligent product matching</span>
            </li>
            <li className="flex items-start">
              <span className="text-teal-600 mr-2">•</span>
              <span>RAG pipeline combining retrieval and generation for personalized recommendations</span>
            </li>
            <li className="flex items-start">
              <span className="text-teal-600 mr-2">•</span>
              <span>Scalable backend with FastAPI and Redis caching layer</span>
            </li>
            <li className="flex items-start">
              <span className="text-teal-600 mr-2">•</span>
              <span>Google Cloud infrastructure with BigQuery vector indexing</span>
            </li>
          </ul>
        </div>
      </div>

      {/* OAuth Login */}
      <div className="space-y-4">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-50 text-gray-500 font-medium">Try the MVP Demo</span>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full h-12 border-gray-300 hover:bg-gray-50 transition-colors"
            onClick={() => signIn("google", { callbackUrl: "/" })}
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full h-12 border-gray-300 hover:bg-gray-50 transition-colors"
            onClick={() => signIn("github", { callbackUrl: "/" })}
          >
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </Button>
        </div>

        <p className="text-center text-xs text-gray-500 pt-2">
          Sign in to explore our intelligent product recommendation system
        </p>
      </div>
    </div>
  );
}