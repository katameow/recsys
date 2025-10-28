"use client";

import { CompanyLogos } from "./CompanyLogos";
import { Server, Database, Cpu, Cloud } from "lucide-react";

export function TestimonialSection() {
  return (
    <div className="h-full flex flex-col justify-between p-12 text-white">
      <div className="flex-1 flex flex-col justify-center space-y-10">
        <div className="space-y-6">
          <h2 className="text-4xl font-bold leading-tight">
            Katalyst: AI-Powered Product Discovery Through Semantic Search
          </h2>
          <p className="text-xl text-teal-100 leading-relaxed">
            A Retrieval-Augmented Generation system that transforms how customers discover products 
            using intelligent semantic search and personalized recommendations.
          </p>
        </div>

        {/* Architecture Highlights */}
        <div className="space-y-4">
          <h3 className="text-2xl font-semibold text-teal-100">Full-Stack MVP Architecture</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-start space-x-3 p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <Server className="w-6 h-6 text-teal-300 mt-1 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-white">FastAPI Backend</h4>
                <p className="text-sm text-teal-100">RESTful API with async operations</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3 p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <Database className="w-6 h-6 text-teal-300 mt-1 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-white">Redis Caching</h4>
                <p className="text-sm text-teal-100">High-performance data layer</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3 p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <Cpu className="w-6 h-6 text-teal-300 mt-1 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-white">Vector Embeddings</h4>
                <p className="text-sm text-teal-100">ML-powered semantic matching</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3 p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <Cloud className="w-6 h-6 text-teal-300 mt-1 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-white">Google Cloud</h4>
                <p className="text-sm text-teal-100">BigQuery & cloud infrastructure</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tech Stack Summary */}
        <div className="p-6 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
          <h4 className="font-semibold text-white mb-3 text-lg">Technology Stack</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-teal-300 font-medium">Frontend:</span>
              <span className="text-white ml-2">Next.js, React, TypeScript</span>
            </div>
            <div>
              <span className="text-teal-300 font-medium">Backend:</span>
              <span className="text-white ml-2">FastAPI, Python, LangChain, Pydantic </span>
            </div>
            <div>
              <span className="text-teal-300 font-medium">Database:</span>
              <span className="text-white ml-2">BigQuery, Redis</span>
            </div>
            <div>
              <span className="text-teal-300 font-medium">Auth:</span>
              <span className="text-white ml-2">NextAuth.js</span>
            </div>
            <div>
              <span className="text-teal-300 font-medium">AI/ML:</span>
              <span className="text-white ml-2">text-embedding-004, VertexAI</span>
            </div>
            <div>
              <span className="text-teal-300 font-medium">Cloud:</span>
              <span className="text-white ml-2">Google Cloud Platform</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <p className="text-teal-200 text-sm font-medium tracking-wide uppercase">
          Integrates with different functionalities
        </p>
        <CompanyLogos />
      </div>
    </div>
  );
}